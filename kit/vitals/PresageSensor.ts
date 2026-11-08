/**
 * kit/vitals/PresageSensor.ts
 *
 * Renderer-side wrapper around the SmartSpectra SDK for apps that need blinks
 * as well as pulse and breathing.
 *
 * Events:
 *   blink(atMs)          the eyes just closed (SDK timestamp, ms)
 *   reading(r)           latest pulse and breathing, held for up to 10 s
 *   face(present)        false while the SDK reports no face or the face
 *                        turned away; true again once it is back
 *   hint({code,message}) friendly framing hint for every validation status
 *   fatalError(message)  the session cannot continue; the sensor has already
 *                        stopped the SDK and the camera
 *
 * The caller supplies the MediaStream and the API key; the key is not kept
 * anywhere else.
 */

import {
  SmartSpectraSDK,
  breathingMetrics,
  cardioMetrics,
  faceMetrics,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { TinyEmitter } from './TinyEmitter';
import { readingFromMetrics } from './decodeReading';
import { createBlinkTracker } from './blinks';
import { classifySdkError } from './errorPolicy';
import { createHoldLatestState } from '../signal/holdLatest';
import type { VitalsReading } from './types';

export interface PresageSensorEvents {
  blink: (atMs: number) => void;
  reading: (r: VitalsReading) => void;
  face: (present: boolean) => void;
  hint: (h: { code: number; message: string }) => void;
  fatalError: (message: string) => void;
}

/** Validation codes that mean the player is not facing the camera. */
const FACE_GONE = new Set([1, 17]); // kNoFaceFound, kFaceNotForward

const HINTS: Record<number, string> = {
  0: 'Signal good',
  1: 'Move into the frame',
  2: 'Only one face, please',
  3: 'Centre your face',
  4: 'Adjust your distance',
  5: 'Too dark: add some light',
  6: 'Too bright: turn down the light behind you',
  7: 'Show your shoulders',
  10: 'Camera adjusting…',
  11: 'Camera frame rate too low',
  12: 'Hold still',
  13: 'Move back a little',
  14: 'Move closer',
  15: 'Lower your face in the frame',
  16: 'Raise your face in the frame',
  17: 'Look at the screen',
};

export function hintFor(code: number): string {
  return HINTS[code] ?? 'Adjusting…';
}

export class PresageSensor extends TinyEmitter<PresageSensorEvents> {
  private readonly sdk: SmartSpectraSDK;
  private readonly stream: MediaStream;
  private stopped = false;
  private facePresent = true;

  constructor(apiKey: string, stream: MediaStream, telemetry: boolean) {
    super();
    this.stream = stream;
    this.sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...faceMetrics, ...cardioMetrics, ...breathingMetrics],
      enableTelemetry: telemetry,
    });
    this.sdk.useMediaStream(stream);
    this.wire();
  }

  get mediaStream(): MediaStream {
    return this.stream;
  }

  async start(): Promise<void> {
    await this.sdk.start();
  }

  /** Stop the SDK and turn the camera off. Safe to call more than once. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.sdk.stop();
    } catch (err) {
      console.warn('[PresageSensor] stop failed:', err);
    }
    for (const t of this.stream.getTracks()) t.stop();
  }

  private wire(): void {
    const hold = createHoldLatestState(10_000);
    const blinks = createBlinkTracker();

    this.sdk.on('metrics', (buf: Uint8Array, ts: number) => {
      if (this.stopped) return;
      try {
        const m = decodeMetrics(buf);
        for (const at of blinks.push(m.face?.blinking)) this.emit('blink', at);
        this.emit('reading', hold.push(readingFromMetrics(m, ts)));
      } catch (err) {
        console.warn('[PresageSensor] could not decode metrics:', err);
      }
    });

    this.sdk.on('validationStatus', (code: number) => {
      const c = Number(code);
      this.emit('hint', { code: c, message: hintFor(c) });
      const present = !FACE_GONE.has(c);
      if (present !== this.facePresent) {
        this.facePresent = present;
        this.emit('face', present);
      }
    });

    this.sdk.on('error', (code: number, message: string, retryable: boolean) => {
      console.error(`[PresageSensor] SDK error code=${code} retryable=${retryable}: ${message}`);
      const action = classifySdkError(Number(code), retryable);
      if (action.kind === 'fatal' && !this.stopped) {
        void this.stop();
        this.emit('fatalError', action.message);
      }
    });
  }
}
