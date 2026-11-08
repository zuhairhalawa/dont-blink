/**
 * kit/vitals/PersonMask.ts
 *
 * Separates the player from their room with MediaPipe's selfie segmenter,
 * running on this computer. The result is a small canvas whose alpha is the
 * chance each pixel belongs to the person, ready to cut the player out of the
 * camera image so things can be drawn behind them.
 *
 * Runs five times a second; drawing reuses the latest mask.
 */

import { ImageSegmenter } from '@mediapipe/tasks-vision';
import { visionFileset, type LoadAsset } from './mediapipeFiles';

export class PersonMask {
  /** Alpha mask, at the segmenter's resolution (stretch it to the frame). */
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private image: ImageData | null = null;
  private timer: number | null = null;
  private lastTs = 0;
  private ready = false;

  private constructor(private readonly segmenter: ImageSegmenter, private readonly video: HTMLVideoElement) {}

  static async create(video: HTMLVideoElement, loadAsset: LoadAsset): Promise<PersonMask> {
    const [files, model] = await Promise.all([visionFileset(loadAsset), loadAsset('segment-model')]);
    // CPU: on the GPU, reading results back every frame stalled the page and
    // the Presage SDK failed every ~10 s in a play-test.
    const make = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    const segmenter = await make('CPU');
    return new PersonMask(segmenter, video);
  }

  /** True once at least one mask has been produced. */
  get hasMask(): boolean {
    return this.ready;
  }

  start(intervalMs = 200): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.update(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.segmenter.close();
  }

  private update(): void {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    const ts = Math.max(this.lastTs + 1, performance.now());
    this.lastTs = ts;
    try {
      const res = this.segmenter.segmentForVideo(v, ts);
      const mask = res.confidenceMasks?.[0];
      if (mask) {
        const w = mask.width;
        const h = mask.height;
        const conf = mask.getAsFloat32Array();
        if (!this.image || this.image.width !== w || this.image.height !== h) {
          this.canvas.width = w;
          this.canvas.height = h;
          this.image = this.ctx.createImageData(w, h);
        }
        const px = this.image.data;
        for (let i = 0; i < conf.length; i++) {
          // Soften the edge a little: below 0.3 is room, above 0.7 is person.
          const a = Math.min(1, Math.max(0, (conf[i]! - 0.3) / 0.4));
          px[i * 4 + 3] = a * 255;
        }
        this.ctx.putImageData(this.image, 0, 0);
        this.ready = true;
      }
      res.close();
    } catch (err) {
      console.warn('[PersonMask] segmentation failed:', err);
    }
  }
}
