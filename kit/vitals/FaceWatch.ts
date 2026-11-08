/**
 * kit/vitals/FaceWatch.ts
 *
 * Watches a camera stream for a face turned toward the screen, using
 * Chromium's built-in Shape Detection FaceDetector. On Windows it runs on the
 * device through the operating system's face analysis, so frames never leave
 * the computer. Electron enables it with the
 * `enable-experimental-web-platform-features` switch (set in the main process).
 *
 * The detector finds faces looking roughly at the camera; a head turned away,
 * or no one in the frame, reads as "away". Eye movements alone can't be seen.
 */

import { createPresenceFilter } from './presence';

interface DetectedFace { boundingBox: DOMRectReadOnly }
interface FaceDetectorLike { detect(src: CanvasImageSource): Promise<DetectedFace[]> }
type FaceDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;

/** True when this browser exposes FaceDetector. */
export function faceWatchSupported(): boolean {
  return typeof (window as unknown as { FaceDetector?: unknown }).FaceDetector === 'function';
}

export class FaceWatch {
  private readonly video: HTMLVideoElement;
  private readonly detector: FaceDetectorLike;
  private readonly filter = createPresenceFilter();
  private timer: number | null = null;
  private busy = false;

  /**
   * @param onChange  Called with true (face back) or false (looked away).
   * @param minFaceFraction  Faces narrower than this fraction of the frame
   *                         (someone far behind you) are ignored.
   */
  constructor(stream: MediaStream, private readonly onChange: (present: boolean) => void,
    private readonly minFaceFraction = 0.08) {
    const Ctor = (window as unknown as { FaceDetector: FaceDetectorCtor }).FaceDetector;
    this.detector = new Ctor({ fastMode: true, maxDetectedFaces: 1 });
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    void this.video.play().catch(() => undefined);
  }

  get present(): boolean {
    return this.filter.present;
  }

  /** Sample about seven times a second. */
  start(intervalMs = 140): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => void this.sample(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.video.srcObject = null;
  }

  private async sample(): Promise<void> {
    if (this.busy || this.video.readyState < 2 || !this.video.videoWidth) return;
    this.busy = true;
    try {
      const faces = await this.detector.detect(this.video);
      const minW = this.video.videoWidth * this.minFaceFraction;
      const present = faces.some((f) => f.boundingBox.width >= minW);
      const change = this.filter.push(present, performance.now());
      if (change !== null) this.onChange(change);
    } catch (err) {
      console.warn('[FaceWatch] detect failed:', err);
    } finally {
      this.busy = false;
    }
  }
}
