/**
 * kit/vitals/RendererVitalsSource.ts
 *
 * Renderer-side vitals source backed by the SmartSpectra renderer SDK.
 * Wraps SmartSpectraSDK, wires its events to typed VitalsSource events, and
 * owns the MediaStream lifecycle (stops tracks on stop()).
 *
 * Runs entirely in the Electron renderer process — never import in main.
 *
 * Design §4.2.
 *
 * Construction:
 *   new RendererVitalsSource(apiKey, stream)
 *     apiKey — from window.heartline.getPresageApiKey() (never stored globally)
 *     stream — from getUserMedia() for live, or video.captureStream() for demo
 *
 * Events emitted:
 *   'reading'    — VitalsReading decoded from every SDK 'metrics' event,
 *                  merged with holdLatest so both fields are always populated
 *                  from the most recent known values (within the 10 s TTL).
 *   'hint'       — { code, message } from 'validationStatus'; code kOk (0)
 *                  is mapped to a positive message shown in green.
 *   'fatalError' — unrecoverable error (e.g. kAuthenticationFailed)
 */

import { TinyEmitter } from './TinyEmitter';
import type { VitalsSourceEvents } from './VitalsSource';
import {
  SmartSpectraSDK,
  breathingMetrics,
  cardioMetrics,
  SmartSpectraErrorCode,
} from '@smartspectra/node-sdk/renderer';
import type {
  SmartSpectraErrorCodeValue,
  ValidationCodeValue,
} from '@smartspectra/node-sdk/renderer';
import { decodeReading } from './decodeReading';
import type { VitalsSource } from './VitalsSource';
import { createHoldLatestState } from '../signal/holdLatest';

// ---------------------------------------------------------------------------
// Validation-code → user-facing message mapping
// ---------------------------------------------------------------------------

/**
 * Whether this validation code represents a positive/OK state (no problem).
 * Used by the UI to decide the colour of the hint (green vs warning).
 */
export function isValidationOk(code: number): boolean {
  return code === 0; // ValidationCode.kOk
}

/**
 * Map a numeric ValidationCode to a short, plain user-facing message.
 *
 * kOk (0) gets a positive message; all other codes are instructions to fix
 * the framing or environment.  The SDK's own `hint` string is long and
 * technical, so we replace it entirely.
 *
 * Codes confirmed in node_modules/@smartspectra/node-sdk/js/index.d.ts:
 *   kOk=0, kNoFaceFound=1, kMultipleFacesFound=2, kFaceNotCentered=3,
 *   kTooDark=5, kTooBright=6, kChestNotVisible=7, kCameraTuning=10,
 *   kFrameRateTooLow=11, kExcessiveMotion=12, kFaceTooClose=13,
 *   kFaceTooFar=14, kFaceTooHigh=15, kFaceTooLow=16, kFaceNotForward=17.
 */
export function validationMessage(code: number): string {
  switch (code) {
    case 0:  return 'Signal good — measuring.';
    case 1:  return 'No face found. Move into the frame.';
    case 2:  return 'Multiple faces detected. Only one person should be visible.';
    case 3:  return 'Centre your face in the frame.';
    case 5:  return 'Too dark. Move to a brighter spot.';
    case 6:  return 'Too bright. Reduce the light behind you.';
    case 7:  return 'Show more of your neck and upper chest.';
    case 10: return 'Adjusting to your camera — hold still.';
    case 11: return 'Camera frame rate too low. Close other apps and try again.';
    case 12: return 'Too much movement. Sit still and hold the device steady.';
    case 13: return 'Too close to the camera. Move back a little.';
    case 14: return 'Too far from the camera. Move closer.';
    case 15: return 'Face too high in the frame. Lower the camera or sit up less.';
    case 16: return 'Face too low in the frame. Raise the camera or sit up straighter.';
    case 17: return 'Look straight at the camera.';
    default: return 'Adjusting — hold still.';
  }
}

// ---------------------------------------------------------------------------
// RendererVitalsSource
// ---------------------------------------------------------------------------

export class RendererVitalsSource
  extends TinyEmitter<VitalsSourceEvents>
  implements VitalsSource {
  private readonly _sdk: SmartSpectraSDK;
  private readonly _stream: MediaStream;

  /**
   * @param apiKey     The Presage API key — obtained via IPC, passed straight
   *                   to the SDK.  The caller must not hold onto this reference
   *                   after construction (AC-13.4).
   * @param stream     A MediaStream whose video tracks feed the SDK.  The caller
   *                   owns the stream; RendererVitalsSource stops all its tracks
   *                   when stop() is called.
   * @param telemetry  Whether to send the SDK's anonymous per-session telemetry
   *                   summary to Presage.  Mirrors the user's consent choice.
   *                   Defaults to false (opt-in).
   */
  constructor(apiKey: string, stream: MediaStream, telemetry = false) {
    super();
    this._stream = stream;

    // Construct the renderer SDK with the API key, the metric types we need,
    // and the user's telemetry preference.
    this._sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics],
      enableTelemetry: telemetry,
    });

    // Supply our MediaStream before start() so the SDK does not open its own
    // camera (design §4.2).
    this._sdk.useMediaStream(stream);

    // Wire SDK events to our typed EventEmitter events.
    this._wireEvents();
  }

  /** Begin processing.  Resolves once the SDK reports running. */
  async start(): Promise<void> {
    await this._sdk.start();
  }

  /**
   * The MediaStream that feeds the SDK.
   * Exposed so callers (e.g. the calibration view) can attach it to a
   * <video> element for a live preview without a second getUserMedia call.
   */
  get stream(): MediaStream {
    return this._stream;
  }

  /**
   * Stop processing and release the MediaStream tracks.
   * The SDK's own tracks are left alone (the host — us — supplied the stream,
   * so we own its lifecycle per the SDK contract).
   */
  async stop(): Promise<void> {
    await this._sdk.stop();
    // Stop every track so the webcam indicator light goes off.
    for (const track of this._stream.getTracks()) {
      track.stop();
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private _wireEvents(): void {
    // Hold the most-recent known pulse and breathing across partial readings.
    // The SDK emits them in separate events, so without this the readout would
    // show "no reading" for whichever metric wasn't in the latest event.
    const hold = createHoldLatestState(10_000);

    // metrics(buf, timestampUs) — decode and re-emit as a typed VitalsReading.
    this._sdk.on('metrics', (buf: Uint8Array, ts: number) => {
      try {
        const partial = decodeReading(buf, ts);
        // Merge into the held state so both pulse and breathing are populated.
        const merged = hold.push(partial);
        this.emit('reading', merged);
      } catch (err) {
        // Decode errors are non-fatal: log and continue.
        console.warn('[RendererVitalsSource] decodeReading error:', err);
      }
    });

    // validationStatus(code, ts, hint) — map to a friendly message and re-emit.
    this._sdk.on('validationStatus', (code: ValidationCodeValue, _ts: number, _sdkHint: string) => {
      const numericCode = Number(code);
      this.emit('hint', {
        code:    String(numericCode),
        message: validationMessage(numericCode),
      });
    });

    // error(code, message, retryable) — split by error code.
    this._sdk.on('error', (code: SmartSpectraErrorCodeValue, message: string, _retryable: boolean) => {
      if (code === SmartSpectraErrorCode.kAuthenticationFailed) {
        // Unrecoverable: bad / missing API key.  Tell the host to show an
        // error modal and let it call stop().
        this.emit('fatalError',
          `Authentication failed — check your PRESAGE_API_KEY. (${message})`);
        return;
      }

      if (code === SmartSpectraErrorCode.kNonMonotonicTimestamp) {
        // Non-fatal: the SDK detected a timestamp ordering issue.  Log and
        // continue; the SDK will recover on its own.
        console.warn(
          '[RendererVitalsSource] kNonMonotonicTimestamp — continuing.', message);
        return;
      }

      // All other errors: log.  Retryable ones are left to the SDK's own
      // retry logic; the host can react by listening for 'fatalError'.
      console.error(
        `[RendererVitalsSource] SDK error code=${code}: ${message}`);
    });
  }
}
