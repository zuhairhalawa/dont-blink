/**
 * kit/vitals/PresageSensor.ts
 *
 * Renderer-side wrapper around the SmartSpectra SDK for apps that need blinks
 * as well as pulse and breathing.
 *
 * Events:
 *   blink(atMs)          the eyes just closed (SDK timestamp, ms)
 *   reading(r)           latest pulse and breathing, held for up to 10 s
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
  hint: (h: { code: number; message: string }) => void;
  fatalError: (message: string) => void;
}

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
  private recovering = false;
  /** Times of recent recoveries, to give up if the SDK keeps failing. */
  private recoveries: number[] = [];

  /**
   * @param opts.vitals  Also read pulse and breathing. Off means blinks only,
   *                     which is much lighter for the SDK.
   */
  constructor(apiKey: string, stream: MediaStream, opts: { telemetry: boolean; vitals: boolean }) {
    super();
    this.stream = stream;
    this.sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: opts.vitals ? [...faceMetrics, ...cardioMetrics, ...breathingMetrics] : [...faceMetrics],
      enableTelemetry: opts.telemetry,
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

  /**
   * Stop the SDK and, unless keepCamera is set, turn the camera off.
   * Safe to call more than once.
   */
  async stop(keepCamera = false): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.sdk.stop();
    } catch (err) {
      console.warn('[PresageSensor] stop failed:', err);
    }
    if (!keepCamera) for (const t of this.stream.getTracks()) t.stop();
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

    let lastCode = -1;
    this.sdk.on('validationStatus', (code: number) => {
      const c = Number(code);
      if (c !== lastCode) {
        lastCode = c;
        console.info(`[presage] status ${c}: ${hintFor(c)}`);
      }
      this.emit('hint', { code: c, message: hintFor(c) });
    });

    this.sdk.on('error', (code: number, message: string, retryable: boolean) => {
      console.error(`[PresageSensor] SDK error code=${code} retryable=${retryable}: ${message}`);
      const action = classifySdkError(Number(code), retryable);
      if (action.kind === 'fatal' && !this.stopped) {
        void this.stop();
        this.emit('fatalError', action.message);
      } else if (Number(code) === 8) {
        // kProcessingFailed: in play-tests the SDK said "retryable" but then
        // stayed stuck ("not in a valid state"), and pulse and blinks stopped.
        void this.recover();
      }
    });

    // ProcessingStatus.kError (5): the pipeline has stopped; rebuild it.
    this.sdk.on('processingStatus', (status: number) => {
      console.info(`[presage] processing ${Number(status)}`);
      if (Number(status) === 5) void this.recover();
    });
  }

  /**
   * Rebuild the SDK pipeline after it fails (reset() then start(), as the SDK
   * documents for its error state). Gives up with a fatal error after three
   * recoveries within a minute.
   */
  private async recover(): Promise<void> {
    if (this.stopped || this.recovering) return;
    const now = Date.now();
    this.recoveries = this.recoveries.filter((t) => now - t < 60_000);
    if (this.recoveries.length >= 3) {
      void this.stop();
      this.emit('fatalError', 'The Presage SDK kept failing to process video. Restart the game to try again.');
      return;
    }
    this.recoveries.push(now);
    this.recovering = true;
    console.warn('[PresageSensor] processing failed; restarting the SDK pipeline');
    try {
      await this.sdk.reset();
      if (!this.stopped) await this.sdk.start();
      console.warn('[PresageSensor] SDK pipeline restarted');
    } catch (err) {
      console.error('[PresageSensor] restart failed:', err);
    } finally {
      this.recovering = false;
    }
  }
}
