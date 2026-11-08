/**
 * src/renderer/game/summary.ts
 *
 * Turns a finished round (the rules' event log plus the pulse and breathing
 * samples recorded during it) into the numbers on the end card.
 *
 * Pure functions: no DOM, so they are unit-tested.
 */

import type { GameState } from './rules';
import { ROUND_MS } from './rules';

/** One vitals sample during the round. `t` is ms since the round started. */
export interface Sample {
  t: number;
  pulse: number | null;
  breathing: number | null;
}

export interface RoundSummary {
  outcome: 'caught' | 'survived';
  /** How long the round lasted, ms. */
  durationMs: number;
  blinks: number;
  lookAways: number;
  /** Blink times, ms since start. */
  blinkTimes: number[];
  /** Longest stretch with no blink and no look-away, ms. */
  longestStareMs: number;
  /** Mean pulse over the first 10 s of the round, or null. */
  pulseStart: number | null;
  /** Highest pulse during the round and when it happened. */
  pulsePeak: number | null;
  pulsePeakT: number | null;
  /** Mean breathing rate over the round, or null. */
  breathingMean: number | null;
  /** Closest the Watcher got (0-8). */
  maxStep: number;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function summarize(game: GameState, samples: readonly Sample[]): RoundSummary {
  const end = game.events.find((e) => e.kind === 'caught' || e.kind === 'survived');
  const outcome = end?.kind === 'caught' ? 'caught' : 'survived';
  const durationMs = end ? end.t : ROUND_MS;

  const blinkTimes = game.events.filter((e) => e.kind === 'blink').map((e) => e.t);
  const losses = game.events.filter((e) => e.kind === 'blink' || e.kind === 'eyesShut' || e.kind === 'lookAway').map((e) => e.t);
  let longestStareMs = 0;
  let prev = 0;
  for (const t of [...losses, durationMs]) {
    longestStareMs = Math.max(longestStareMs, t - prev);
    prev = t;
  }

  const inRound = samples.filter((s) => s.t >= 0 && s.t <= durationMs);
  const pulses = inRound.filter((s): s is Sample & { pulse: number } => s.pulse !== null);
  const pulseStart = mean(pulses.filter((s) => s.t <= 10_000).map((s) => s.pulse));
  let pulsePeak: number | null = null;
  let pulsePeakT: number | null = null;
  for (const s of pulses) {
    if (pulsePeak === null || s.pulse > pulsePeak) {
      pulsePeak = s.pulse;
      pulsePeakT = s.t;
    }
  }
  const breathingMean = mean(inRound.filter((s) => s.breathing !== null).map((s) => s.breathing as number));

  return {
    outcome,
    durationMs,
    blinks: game.blinks,
    lookAways: game.lookAways,
    blinkTimes,
    longestStareMs,
    pulseStart,
    pulsePeak,
    pulsePeakT,
    breathingMean,
    maxStep: game.maxStep,
  };
}

/** Format milliseconds as m:ss. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Downsample samples to at most `n` points for drawing, keeping time order. */
export function thin<T>(xs: readonly T[], n: number): T[] {
  if (xs.length <= n) return [...xs];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.floor((i * (xs.length - 1)) / (n - 1))]!);
  return out;
}
