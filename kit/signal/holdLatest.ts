/**
 * kit/signal/holdLatest.ts
 *
 * Holds the most-recent pulse rate and breathing rate across a stream of
 * partial readings and drops a held value when it is older than a TTL.
 *
 * WHY THIS EXISTS
 * ---------------
 * The SmartSpectra SDK emits metrics ~30 times a second, but pulse rate and
 * breathing rate arrive in separate events (never both in one event).
 * Without holding, any given VitalsReading will have one of the two fields
 * set and the other null, so the readout shows "no reading" for one metric
 * almost all the time.
 *
 * HOW IT WORKS
 * ------------
 * `holdLatest(readings, ttlMs)` takes the ordered array that has accumulated
 * so far and returns a single merged VitalsReading that carries:
 *   - The most recent non-null pulseRate whose reading.timestamp is within
 *     ttlMs of the *last* reading's timestamp.  Null if none qualifies.
 *   - The most recent non-null breathingRate within the same window.
 *   - The timestamp of the last reading in the array.
 *   - valid = true when the most recent reading is valid.
 *
 * `holdLatestState` is a stateful helper designed for streaming use in
 * RendererVitalsSource.  It maintains the last known values internally and
 * merges each incoming partial reading into a complete one without needing
 * the full history array.
 *
 * Pure function contract: `holdLatest` is a pure function (given a snapshot
 * of the readings array it always returns the same result).  `holdLatestState`
 * is a thin factory that keeps only two numbers and two timestamps in memory.
 */

import type { VitalsReading } from '../vitals/types';

// ---------------------------------------------------------------------------
// Pure batch version (used in tests and for one-shot queries)
// ---------------------------------------------------------------------------

/**
 * Scan `readings` and return a single VitalsReading that holds the latest
 * non-null pulse and breathing values, each discarded when older than `ttlMs`
 * relative to the last reading's timestamp.
 *
 * Returns `null` when `readings` is empty.
 *
 * @param readings  Ordered array of VitalsReadings (oldest first).
 * @param ttlMs     Max age (ms) a held value may have before it is treated as
 *                  stale and set back to null.  Defaults to 10 000 ms.
 */
export function holdLatest(
  readings: VitalsReading[],
  ttlMs = 10_000,
): VitalsReading | null {
  if (readings.length === 0) {
    return null;
  }

  const last = readings[readings.length - 1]!;
  const cutoff = last.timestamp - ttlMs;

  let pulseRate: number | null = null;
  let pulseTs = -Infinity;
  let breathingRate: number | null = null;
  let breathingTs = -Infinity;

  for (const r of readings) {
    if (r.pulseRate !== null && r.timestamp > pulseTs) {
      pulseTs   = r.timestamp;
      pulseRate = r.pulseRate;
    }
    if (r.breathingRate !== null && r.timestamp > breathingTs) {
      breathingTs   = r.timestamp;
      breathingRate = r.breathingRate;
    }
  }

  // Drop values older than the TTL window.
  if (pulseTs < cutoff)     { pulseRate    = null; }
  if (breathingTs < cutoff) { breathingRate = null; }

  return {
    timestamp:     last.timestamp,
    pulseRate,
    breathingRate,
    valid:         last.valid,
  };
}

// ---------------------------------------------------------------------------
// Stateful streaming version (used in RendererVitalsSource)
// ---------------------------------------------------------------------------

/**
 * A small stateful accumulator for streaming use.
 *
 * Call `push(partial)` for every reading that arrives from the SDK.
 * It returns a merged VitalsReading that always carries the most recent
 * non-stale pulse and breathing values, regardless of which one the latest
 * partial reading contained.
 *
 * Usage:
 *   const hold = createHoldLatestState();
 *   source.on('reading', (r) => {
 *     const merged = hold.push(r);
 *     display(merged);
 *   });
 */
export interface HoldLatestState {
  /**
   * Merge `reading` into the held state and return a complete reading.
   * The returned reading shares `reading.timestamp` and `reading.valid`.
   */
  push(reading: VitalsReading): VitalsReading;
  /** Reset all held values to null (e.g. when the source is restarted). */
  reset(): void;
}

/**
 * Create a new stateful hold-latest accumulator.
 *
 * @param ttlMs  Max age (ms) a held value may have before it is treated as
 *               stale.  Defaults to 10 000 ms.
 */
export function createHoldLatestState(ttlMs = 10_000): HoldLatestState {
  let pulseRate:    number | null = null;
  let pulseTs:      number       = -Infinity;
  let breathingRate: number | null = null;
  let breathingTs:   number       = -Infinity;

  return {
    push(reading: VitalsReading): VitalsReading {
      // Update held values if the incoming partial reading has non-null fields.
      if (reading.pulseRate !== null) {
        pulseRate = reading.pulseRate;
        pulseTs   = reading.timestamp;
      }
      if (reading.breathingRate !== null) {
        breathingRate = reading.breathingRate;
        breathingTs   = reading.timestamp;
      }

      // Drop values older than the TTL relative to the current reading.
      const cutoff = reading.timestamp - ttlMs;
      const heldPulse    = pulseTs    >= cutoff ? pulseRate    : null;
      const heldBreath   = breathingTs >= cutoff ? breathingRate : null;

      return {
        timestamp:    reading.timestamp,
        pulseRate:    heldPulse,
        breathingRate: heldBreath,
        valid:        reading.valid,
      };
    },

    reset(): void {
      pulseRate     = null;
      pulseTs       = -Infinity;
      breathingRate = null;
      breathingTs   = -Infinity;
    },
  };
}
