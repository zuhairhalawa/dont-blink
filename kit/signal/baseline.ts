/**
 * kit/signal/baseline.ts
 *
 * Computes a resting-state baseline from a window of VitalsReadings.
 * Pure function — no side effects, no external dependencies.
 */

import type { VitalsReading, Baseline } from '../vitals/types';

/**
 * Aggregate readings that fall within the most-recent `durationMs` window
 * and return the mean pulse rate and breathing rate.
 *
 * Rules:
 *  - Only readings whose `timestamp` is within [latestTimestamp - durationMs,
 *    latestTimestamp] are included.
 *  - `null` values for either metric are excluded from that metric's mean.
 *  - If fewer than 3 valid (non-null) values exist for a metric, that field
 *    in the returned `Baseline` is `null`.
 *
 * @param readings   Array of VitalsReading (may be empty, may have nulls).
 * @param durationMs Length of the aggregation window in milliseconds.
 * @returns          A `Baseline` whose fields are null when data is insufficient.
 */
export function computeBaseline(
  readings: VitalsReading[],
  durationMs: number,
): Baseline {
  // Nothing to work with
  if (readings.length === 0) {
    return { pulseRate: null, breathingRate: null };
  }

  // Find the latest timestamp in the provided readings
  let latestTs = -Infinity;
  for (const r of readings) {
    if (r.timestamp > latestTs) {
      latestTs = r.timestamp;
    }
  }

  const windowStart = latestTs - durationMs;

  // Collect valid values within the window
  const pulseValues: number[] = [];
  const breathingValues: number[] = [];

  for (const r of readings) {
    // Ignore readings outside the window
    if (r.timestamp < windowStart) {
      continue;
    }
    if (r.pulseRate !== null) {
      pulseValues.push(r.pulseRate);
    }
    if (r.breathingRate !== null) {
      breathingValues.push(r.breathingRate);
    }
  }

  // Need at least 3 readings per metric
  const MIN_READINGS = 3;

  const pulseRate =
    pulseValues.length >= MIN_READINGS
      ? pulseValues.reduce((a, b) => a + b, 0) / pulseValues.length
      : null;

  const breathingRate =
    breathingValues.length >= MIN_READINGS
      ? breathingValues.reduce((a, b) => a + b, 0) / breathingValues.length
      : null;

  return { pulseRate, breathingRate };
}
