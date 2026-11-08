/**
 * kit/vitals/HeadWatch.ts
 *
 * Notices when the player turns their head away from the screen, using
 * Google's MediaPipe Face Landmarker running on this computer (WASM, CPU).
 * No frames or points leave the device.
 *
 * Why: the SmartSpectra SDK gives blinks and pulse but, in live tests, its
 * status did not change when the player turned away, and Chromium's built-in
 * FaceDetector kept finding a face even with the head turned fully sideways.
 * The face mesh lets us measure how far the head is turned (headTurn.ts).
 *
 * The caller supplies loadAsset, which returns the WASM runtime and model
 * bytes (Don't Blink reads them through its preload), because a sandboxed
 * file:// page cannot fetch them itself.
 */

import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { headRatios, createHeadJudge } from './headTurn';
import { createPresenceFilter } from './presence';

export type AssetName = 'mediapipe-loader' | 'mediapipe-wasm' | 'face-model';

function blobUrl(bytes: Uint8Array, type: string): string {
  return URL.createObjectURL(new Blob([bytes], { type }));
}

export class HeadWatch {
  private readonly video: HTMLVideoElement;
  private readonly judge = createHeadJudge();
  private readonly filter = createPresenceFilter(400, 250);
  private timer: number | null = null;
  private lastTs = 0;

  private constructor(private readonly landmarker: FaceLandmarker, stream: MediaStream,
    private readonly onChange: (facing: boolean) => void) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    void this.video.play().catch(() => undefined);
  }

  /** Load MediaPipe and the model, then watch `stream`. Rejects if loading fails. */
  static async create(stream: MediaStream, onChange: (facing: boolean) => void,
    loadAsset: (name: AssetName) => Promise<Uint8Array>): Promise<HeadWatch> {
    const [loader, wasm, model] = await Promise.all([
      loadAsset('mediapipe-loader'),
      loadAsset('mediapipe-wasm'),
      loadAsset('face-model'),
    ]);
    const landmarker = await FaceLandmarker.createFromOptions(
      { wasmLoaderPath: blobUrl(loader, 'text/javascript'), wasmBinaryPath: blobUrl(wasm, 'application/wasm') },
      {
        baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
      },
    );
    return new HeadWatch(landmarker, stream, onChange);
  }

  get facing(): boolean {
    return this.filter.present;
  }

  /** Check about ten times a second. */
  start(intervalMs = 100): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.sample(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.video.srcObject = null;
    this.landmarker.close();
  }

  private sample(): void {
    if (this.video.readyState < 2 || !this.video.videoWidth) return;
    const ts = Math.max(this.lastTs + 1, performance.now());
    this.lastTs = ts;
    try {
      const res = this.landmarker.detectForVideo(this.video, ts);
      const lm = res.faceLandmarks[0];
      const facing = this.judge.push(lm ? headRatios(lm) : null);
      const change = this.filter.push(facing, ts);
      if (change !== null) this.onChange(change);
    } catch (err) {
      console.warn('[HeadWatch] detect failed:', err);
    }
  }
}
