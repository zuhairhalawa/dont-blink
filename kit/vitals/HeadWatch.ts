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
import { headAngles, eyesClosedScore, createHeadJudge, EYES_CLOSED, EYES_OPEN } from './headTurn';
import { createPresenceFilter } from './presence';
import { visionFileset, type AssetName, type LoadAsset } from './mediapipeFiles';

export type { AssetName };

/** Where the face is in the camera image, normalised 0-1 (not mirrored). */
export interface FaceBox { cx: number; cy: number; w: number; h: number }

export class HeadWatch {
  private readonly video: HTMLVideoElement;
  private readonly judge = createHeadJudge();
  private filter = createPresenceFilter(400, 250);
  private timer: number | null = null;
  private lastTs = 0;
  private box: FaceBox | null = null;
  private eyesShut = false;
  /** Called when both eyes close (true) or open again (false). */
  onEyes: ((closed: boolean) => void) | null = null;

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
    loadAsset: LoadAsset): Promise<HeadWatch> {
    const [files, model] = await Promise.all([visionFileset(loadAsset), loadAsset('face-model')]);
    // CPU: on the GPU, reading results back every frame stalled the page and
    // the Presage SDK failed every ~10 s in a play-test.
    const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(
      files,
      {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      },
    );
    const landmarker = await make('CPU');
    return new HeadWatch(landmarker, stream, onChange);
  }

  /** The latest face position, or null when no face is found. */
  get faceBox(): FaceBox | null {
    return this.box;
  }

  /**
   * Learn the resting head position again (call while the player is looking
   * at the screen, e.g. at the start of a round). Reports facing meanwhile.
   */
  recalibrate(): void {
    this.judge.reset();
    if (!this.filter.present) this.onChange(true);
    this.filter = createPresenceFilter(400, 250);
  }

  get facing(): boolean {
    return this.filter.present;
  }

  /**
   * Check ten times a second: enough for eyes held shut (quick blinks come from
   * Presage), and light enough to leave the SDK the CPU it needs.
   */
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
      if (lm && lm.length) {
        let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
        for (const p of lm) {
          if (p.x < x0) x0 = p.x;
          if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.y > y1) y1 = p.y;
        }
        this.box = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
      } else {
        this.box = null;
      }
      const matrix = res.facialTransformationMatrixes?.[0]?.data;
      const facing = this.judge.push(lm ? headAngles(matrix) : null);

      // Eyes: closed above EYES_CLOSED, open again below EYES_OPEN.
      const shut = eyesClosedScore(res.faceBlendshapes?.[0]?.categories);
      if (shut !== null) {
        const now = this.eyesShut ? shut > EYES_OPEN : shut > EYES_CLOSED;
        if (now !== this.eyesShut) {
          this.eyesShut = now;
          this.onEyes?.(now);
        }
      }
      const change = this.filter.push(facing, ts);
      if (change !== null) this.onChange(change);
    } catch (err) {
      console.warn('[HeadWatch] detect failed:', err);
    }
  }
}
