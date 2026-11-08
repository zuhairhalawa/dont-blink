/**
 * apps/probe/probe.ts
 *
 * Blink-latency probe for Don't Blink. Not part of the game.
 *
 * It measures three things on the real webcam:
 *   1. Pipeline lag: arrival time minus the SDK's own timestamp, for blink
 *      detections and for landmark frames.
 *   2. Cue-to-blink time: a red circle appears at random moments and the
 *      player blinks. This includes human reaction time (about 200-300 ms).
 *   3. The same for a blink detector we compute ourselves from the eye
 *      landmarks (eye aspect ratio), as a fallback if the SDK's flag lags.
 *
 * Every event is logged as one JSON line on the console for the test script.
 */

import { SmartSpectraSDK, faceMetrics, cardioMetrics } from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

// MediaPipe face-mesh eye landmark indices: p1..p6 for each eye.
const LEFT_EYE = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE = [362, 385, 387, 263, 373, 380] as const;

type Pt = { x?: number | null; y?: number | null };

function dist(a: Pt, b: Pt): number {
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
}

function ear(pts: Pt[], idx: readonly number[]): number | null {
  const p = idx.map((i) => pts[i]);
  if (p.some((q) => !q)) return null;
  const [p1, p2, p3, p4, p5, p6] = p as Pt[];
  const w = dist(p1!, p4!);
  if (w === 0) return null;
  return (dist(p2!, p6!) + dist(p3!, p5!)) / (2 * w);
}

function toMs(ts: unknown): number {
  // Timestamps are microseconds since the Unix epoch (number or Long).
  const n = typeof ts === 'number' ? ts : Number(String(ts));
  return n / 1000;
}

function log(kind: string, data: Record<string, unknown>): void {
  console.log('PROBE ' + JSON.stringify({ kind, t: Date.now(), ...data }));
}

const statusEl = document.getElementById('status')!;
const cueEl = document.getElementById('cue')!;
const statsEl = document.getElementById('stats')!;
const earEl = document.getElementById('ear')!;

let cueAt: number | null = null;
const cueToSdk: number[] = [];
const cueToEar: number[] = [];
const sdkLag: number[] = [];
const lmLag: number[] = [];
let lastSdkDetected = false;
let earClosed = false;
let earBaseline: number | null = null;
let sdkCueDone = false;
let earCueDone = false;

function median(a: number[]): string {
  if (a.length === 0) return '-';
  const s = [...a].sort((x, y) => x - y);
  return String(Math.round(s[Math.floor(s.length / 2)]!));
}

function render(): void {
  statsEl.textContent =
    `SDK blink: lag ${median(sdkLag)} ms, cue->blink ${median(cueToSdk)} ms (${cueToSdk.length})\n` +
    `Eye-shape blink: cue->blink ${median(cueToEar)} ms (${cueToEar.length})\n` +
    `Landmark lag ${median(lmLag)} ms`;
}

function scheduleCue(): void {
  const wait = 3000 + Math.random() * 2500;
  setTimeout(() => {
    cueAt = performance.timeOrigin + performance.now();
    sdkCueDone = false;
    earCueDone = false;
    cueEl.dataset['on'] = 'true';
    log('cue', {});
    setTimeout(() => {
      cueEl.dataset['on'] = 'false';
      scheduleCue();
    }, 1200);
  }, wait);
}

async function main(): Promise<void> {
  const apiKey = await window.heartline.getPresageApiKey();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, frameRate: 30 },
  });
  const track = stream.getVideoTracks()[0];
  log('camera', { settings: track?.getSettings() ?? null });

  const sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...faceMetrics, ...cardioMetrics],
    enableTelemetry: false,
  });
  sdk.useMediaStream(stream);

  sdk.on('validationStatus', (code: number) => {
    statusEl.textContent = code === 0 ? 'Signal good. Blink when the circle turns red.' : `Adjusting (code ${code})`;
  });
  sdk.on('error', (code: number, message: string, retryable: boolean) => {
    log('error', { code, message, retryable });
  });

  sdk.on('metrics', (buf: Uint8Array) => {
    const now = performance.timeOrigin + performance.now();
    const m = decodeMetrics(buf);
    const face = m.face;
    if (!face) return;

    for (const b of face.blinking ?? []) {
      const ts = toMs(b.timestamp);
      if (b.detected && !lastSdkDetected) {
        sdkLag.push(now - ts);
        log('sdkBlink', { lagMs: Math.round(now - ts), stable: b.stable ?? null });
        if (cueAt !== null && !sdkCueDone && now - cueAt < 2000) {
          cueToSdk.push(now - cueAt);
          sdkCueDone = true;
        }
      }
      lastSdkDetected = !!b.detected;
    }

    const lms = face.landmarks ?? [];
    const last = lms[lms.length - 1];
    if (last?.value && last.value.length >= 400) {
      lmLag.push(now - toMs(last.timestamp));
      if (lmLag.length > 300) lmLag.shift();
      const l = ear(last.value, LEFT_EYE);
      const r = ear(last.value, RIGHT_EYE);
      if (l !== null && r !== null) {
        const e = (l + r) / 2;
        // Slow-moving open-eye baseline; a blink is a drop below 70 % of it.
        earBaseline = earBaseline === null ? e : earBaseline * 0.98 + e * 0.02;
        const closed = e < earBaseline * 0.7;
        if (closed && !earClosed) {
          log('earBlink', { ear: +e.toFixed(3), base: +earBaseline.toFixed(3), lagMs: Math.round(now - toMs(last.timestamp)) });
          if (cueAt !== null && !earCueDone && now - cueAt < 2000) {
            cueToEar.push(now - cueAt);
            earCueDone = true;
          }
        }
        earClosed = closed;
        earEl.textContent = `eye openness ${e.toFixed(3)} (open ${earBaseline.toFixed(3)})`;
      }
    }
    render();
  });

  await sdk.start();
  log('started', {});
  scheduleCue();
}

main().catch((e: unknown) => {
  statusEl.textContent = 'Error: ' + (e instanceof Error ? e.message : String(e));
  log('fatal', { message: String(e) });
});
