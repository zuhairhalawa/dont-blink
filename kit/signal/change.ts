/**
 * kit/signal/change.ts
 *
 * Beat-change detection: computes how much a metric has shifted from baseline
 * during a specific time window.
 * Pure functions — no side effects, no external dependencies.
 */

import type { VitalsReading, Baseline, BeatChange } from '../vitals/types';

/**
 * Compute the percentage change of `current` relative to `baseline`.
 *
 * Formula (documented here as the single source of truth):
 *   percentageChange = ((current - baseline) / baseline) * 100
 *
 * Returns `null` when:
 *  - `baseline` is 0 (division by zero — undefined percentage change).
 *
 * @param current   The observed mean value.
 * @param baseline  The resting-state reference value.
 * @returns         Percentage change, or null if baseline is zero.
 */
export function computeChange(
  current: number,
  baseline: number,
): number | null {
  // Cannot compute a percentage when baseline is zero
  if (baseline === 0) {
    return null;
  }

  return ((current - baseline) / baseline) * 100;
}

/**
 * Detect the beat-level change from baseline for a window of readings.
 *
 * Algorithm:
 *  1. Filter readings to those whose timestamp falls within the most-recent
 *     `windowMs` milliseconds.
 *  2. Compute the mean pulse rate and mean breathing rate from non-null values
 *     in that window.  If no non-null values exist for a metric, that mean is
 *     treated as unavailable.
 *  3. Compare each mean to the corresponding baseline value using
 *     `computeChange`.
 *  4. If the baseline field itself is null, the delta fields are null.
 *
 * @param readings   All readings available for the beat (may be mixed-null).
 * @param windowMs   Duration of the window to analyse (most-recent readings).
 * @param baseline   Resting-state reference values.
 * @returns          `BeatChange` with deltas; fields are null when unavailable.
 */
export function detectBeatChange(
  readings: VitalsReading[],
  windowMs: number,
  baseline: Baseline,
): BeatChange {
  // Determine window start
  let latestTs = -Infinity;
  for (const r of readings) {
    if (r.timestamp > latestTs) {
      latestTs = r.timestamp;
    }
  }

  const windowStart = latestTs - windowMs;

  // Accumulate means within the window
  let pulseSum = 0;
  let pulseCount = 0;
  let breathingSum = 0;
  let breathingCount = 0;

  for (const r of readings) {
    if (r.timestamp < windowStart) {
      continue;
    }
    if (r.pulseRate !== null) {
      pulseSum += r.pulseRate;
      pulseCount++;
    }
    if (r.breathingRate !== null) {
      breathingSum += r.breathingRate;
      breathingCount++;
    }
  }

  // Compute deltas — null when baseline or current mean unavailable
  const currentPulse = pulseCount > 0 ? pulseSum / pulseCount : null;
  const currentBreathing = breathingCount > 0 ? breathingSum / breathingCount : null;

  let pulseDeltaBpm: number | null = null;
  let pulseDeltaPct: number | null = null;

  if (currentPulse !== null && baseline.pulseRate !== null) {
    pulseDeltaBpm = currentPulse - baseline.pulseRate;
    pulseDeltaPct = computeChange(currentPulse, baseline.pulseRate);
  }

  let breathingDeltaBpm: number | null = null;
  let breathingDeltaPct: number | null = null;

  if (currentBreathing !== null && baseline.breathingRate !== null) {
    breathingDeltaBpm = currentBreathing - baseline.breathingRate;
    breathingDeltaPct = computeChange(currentBreathing, baseline.breathingRate);
  }

  return { pulseDeltaBpm, pulseDeltaPct, breathingDeltaBpm, breathingDeltaPct };
}
