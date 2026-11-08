/**
 * src/renderer/game/endCard.ts
 *
 * Draws the end card on a canvas so the same image is shown on screen and
 * saved as a PNG. 1200 x 630 (a common share-card size).
 *
 * Left: the result and four numbers. Right: your pulse across the round,
 * with every blink marked in red.
 */

import type { RoundSummary, Sample } from './summary';
import { clock, thin } from './summary';
import { CAUGHT_STEP } from './rules';

export const CARD_W = 1200;
export const CARD_H = 630;

const C = {
  wall: '#1B1712',
  bone: '#E9E2D3',
  dim: '#9C9180',
  bulb: '#E8B04A',
  vein: '#B3122E',
};

const DISPLAY = '"Bahnschrift", "DIN Alternate", "Arial Narrow", sans-serif';
const TEXT = '"Sitka Text", "Georgia", serif';

/**
 * @param photo  The scare-cam still of the player's face (already mirrored),
 *               or null when none was taken. Shown above the pulse chart.
 */
export function drawEndCard(canvas: HTMLCanvasElement, s: RoundSummary, samples: readonly Sample[],
  photo: HTMLCanvasElement | null = null): void {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = C.wall;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Result, set like the top line of an eye chart.
  ctx.fillStyle = s.outcome === 'caught' ? C.vein : C.bulb;
  ctx.font = `600 96px ${DISPLAY}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s.outcome === 'caught' ? 'CAUGHT' : 'SURVIVED', 64, 150);
  ctx.fillStyle = C.bone;
  ctx.font = `400 30px ${TEXT}`;
  ctx.fillText(
    s.outcome === 'caught'
      ? `The Watcher reached you at ${clock(s.durationMs)}.`
      : `You held it off for the full ${clock(s.durationMs)}.`,
    64, 204,
  );

  // Four numbers, each with a plain label.
  const stats: [string, string][] = [
    [String(s.blinks), s.blinks === 1 ? 'blink' : 'blinks'],
    [`${(s.longestStareMs / 1000).toFixed(1)} s`, 'longest stare'],
    [s.pulsePeak !== null ? `${Math.round(s.pulsePeak)}` : '–', 'peak pulse, bpm'],
    [s.pulseStart !== null && s.pulsePeak !== null ? signed(Math.round(s.pulsePeak - s.pulseStart)) : '–', 'pulse rise, bpm'],
  ];
  stats.forEach(([value, label], i) => {
    const x = 64 + (i % 2) * 220;
    const y = 320 + Math.floor(i / 2) * 130;
    ctx.fillStyle = C.bone;
    ctx.font = `600 64px ${DISPLAY}`;
    ctx.fillText(value, x, y);
    ctx.fillStyle = C.dim;
    ctx.font = `400 22px ${TEXT}`;
    ctx.fillText(label, x, y + 34);
  });

  // Closest distance as a row of steps.
  const rowY = 515;
  for (let i = 1; i <= CAUGHT_STEP; i++) {
    ctx.fillStyle = i <= s.maxStep ? C.vein : '#3a3128';
    ctx.fillRect(64 + (i - 1) * 46, rowY, 36, 10);
  }
  ctx.fillStyle = C.dim;
  ctx.font = `400 20px ${TEXT}`;
  ctx.fillText('closest it came', 64, rowY + 40);

  if (photo) {
    // Scare cam: the player's face at the worst moment, toned to match the corridor.
    const pw = 400;
    const ph = Math.round((pw * photo.height) / photo.width);
    ctx.save();
    ctx.filter = 'sepia(0.55) contrast(1.15) brightness(0.95)';
    ctx.drawImage(photo, 580, 44, pw, ph);
    ctx.restore();
    ctx.strokeStyle = s.outcome === 'caught' ? C.vein : C.bulb;
    ctx.lineWidth = 4;
    ctx.strokeRect(580, 44, pw, ph);
    ctx.fillStyle = C.bone;
    ctx.font = `400 22px ${TEXT}`;
    ctx.fillText(s.outcome === 'caught' ? 'Your face when it caught you' : 'Your face when it came closest', 580, 44 + ph + 32);
    drawPulseChart(ctx, s, samples, 580, 44 + ph + 92, 500, CARD_H - (44 + ph + 92) - 70);
  } else {
    drawPulseChart(ctx, s, samples, 580, 90, 500, 440);
  }

  ctx.fillStyle = C.dim;
  ctx.font = `400 18px ${TEXT}`;
  ctx.fillText("Don't Blink. Pulse and blinks read from a webcam by Presage SmartSpectra. Not a medical device.", 64, 612);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function drawPulseChart(ctx: CanvasRenderingContext2D, s: RoundSummary, samples: readonly Sample[],
  x: number, y: number, w: number, h: number): void {
  const pts = thin(samples.filter((p) => p.pulse !== null && p.t >= 0 && p.t <= s.durationMs), 400);
  const dur = Math.max(1, s.durationMs);

  ctx.fillStyle = C.dim;
  ctx.font = `400 22px ${TEXT}`;
  ctx.fillText('Your pulse during the round', x, y - 22);

  // Baseline frame.
  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.stroke();

  // Blink marks: a red tick for each blink, full height and faint.
  for (const t of s.blinkTimes) {
    const bx = x + (t / dur) * w;
    ctx.strokeStyle = 'rgba(179,18,46,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.lineTo(bx, y + h);
    ctx.stroke();
    ctx.fillStyle = C.vein;
    ctx.beginPath();
    ctx.arc(bx, y + h, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (pts.length < 2) {
    ctx.fillStyle = C.dim;
    ctx.font = `400 24px ${TEXT}`;
    ctx.fillText('No pulse reading yet. It takes about 20 s to start.', x, y + h / 2);
    return;
  }

  const vals = pts.map((p) => p.pulse as number);
  const lo = Math.floor(Math.min(...vals) - 4);
  const hi = Math.ceil(Math.max(...vals) + 4);
  const Y = (v: number) => y + h - ((v - lo) / (hi - lo)) * h;
  const X = (t: number) => x + (t / dur) * w;

  ctx.strokeStyle = C.bulb;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.t), Y(p.pulse!)) : ctx.lineTo(X(p.t), Y(p.pulse!))));
  ctx.stroke();

  // Axis values: low and high bpm, start and end time.
  ctx.fillStyle = C.dim;
  ctx.font = `400 18px ${TEXT}`;
  ctx.fillText(`${hi} bpm`, x + w + 10, y + 6);
  ctx.fillText(`${lo} bpm`, x + w + 10, y + h);
  ctx.fillText('0:00', x, y + h + 28);
  ctx.fillText(clock(dur), x + w - 34, y + h + 28);

  if (s.pulsePeak !== null && s.pulsePeakT !== null) {
    const px = X(s.pulsePeakT);
    const py = Y(s.pulsePeak);
    ctx.fillStyle = C.bone;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 22px ${DISPLAY}`;
    ctx.fillText(`${Math.round(s.pulsePeak)}`, Math.min(px + 10, x + w - 40), py - 12);
  }
}
