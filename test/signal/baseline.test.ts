/**
 * test/signal/baseline.test.ts
 *
 * Unit tests for computeBaseline (kit/signal/baseline.ts).
 * Covers all branches for 100% branch coverage.
 */

import { describe, it, expect } from 'vitest';
import { computeBaseline } from 'kit/signal';
import type { VitalsReading } from 'kit/vitals/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a VitalsReading with sensible defaults so tests stay concise. */
function reading(
  timestamp: number,
  pulseRate: number | null,
  breathingRate: number | null,
  valid = true,
): VitalsReading {
  return { timestamp, pulseRate, breathingRate, valid };
}

describe('computeBaseline', () => {
  // -----------------------------------------------------------------------
  // Empty input
  // -----------------------------------------------------------------------

  it('returns null fields for an empty readings array', () => {
    expect(computeBaseline([], 20000)).toEqual({
      pulseRate: null,
      breathingRate: null,
    });
  });

  // -----------------------------------------------------------------------
  // Fewer than 3 readings
  // -----------------------------------------------------------------------

  it('returns null fields when there are fewer than 3 readings', () => {
    const readings = [
      reading(1000, 70, 15),
      reading(2000, 72, 16),
    ];
    expect(computeBaseline(readings, 20000)).toEqual({
      pulseRate: null,
      breathingRate: null,
    });
  });

  it('returns null fields when there is exactly 1 reading', () => {
    expect(computeBaseline([reading(1000, 70, 15)], 20000)).toEqual({
      pulseRate: null,
      breathingRate: null,
    });
  });

  // -----------------------------------------------------------------------
  // Exactly 3 readings (minimum)
  // -----------------------------------------------------------------------

  it('computes correct means with exactly 3 readings', () => {
    const readings = [
      reading(1000, 60, 12),
      reading(2000, 70, 14),
      reading(3000, 80, 16),
    ];
    // pulseRate mean = (60+70+80)/3 = 70
    // breathingRate mean = (12+14+16)/3 = 14
    const result = computeBaseline(readings, 20000);
    expect(result.pulseRate).toBeCloseTo(70, 5);
    expect(result.breathingRate).toBeCloseTo(14, 5);
  });

  // -----------------------------------------------------------------------
  // Readings outside the window are ignored
  // -----------------------------------------------------------------------

  it('ignores readings outside the durationMs window', () => {
    // Latest timestamp = 20000; window = 10000 → start = 10000
    // Readings at t=1000 and t=5000 are outside the window.
    const readings = [
      reading(1000, 55, 10),   // outside → ignored
      reading(5000, 60, 11),   // outside → ignored
      reading(11000, 70, 15),  // inside
      reading(15000, 72, 16),  // inside
      reading(20000, 74, 17),  // inside (latest)
    ];
    const result = computeBaseline(readings, 10000);
    // Only readings at 11000, 15000, 20000 are included
    expect(result.pulseRate).toBeCloseTo((70 + 72 + 74) / 3, 5);
    expect(result.breathingRate).toBeCloseTo((15 + 16 + 17) / 3, 5);
  });

  it('returns null when all readings are outside the window', () => {
    const readings = [
      reading(1000, 70, 15),
      reading(2000, 72, 16),
      reading(3000, 74, 17),
    ];
    // Latest = 3000; window = 100 → start = 2900; only t=3000 is inside (< 3)
    const result = computeBaseline(readings, 100);
    expect(result.pulseRate).toBeNull();
    expect(result.breathingRate).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Null values excluded from mean
  // -----------------------------------------------------------------------

  it('excludes null pulseRate values from the pulse mean', () => {
    const readings = [
      reading(1000, null, 12),  // pulse null → excluded
      reading(2000, 70,   14),
      reading(3000, 80,   16),
      reading(4000, 90,   18),
    ];
    // Pulse: [70, 80, 90] → mean = 80
    // Breathing: [12, 14, 16, 18] → mean = 15
    const result = computeBaseline(readings, 20000);
    expect(result.pulseRate).toBeCloseTo(80, 5);
    expect(result.breathingRate).toBeCloseTo(15, 5);
  });

  it('excludes null breathingRate values from the breathing mean', () => {
    const readings = [
      reading(1000, 60, null),  // breathing null → excluded
      reading(2000, 70, 14),
      reading(3000, 80, 16),
      reading(4000, 90, 18),
    ];
    // Breathing: [14, 16, 18] → mean = 16
    const result = computeBaseline(readings, 20000);
    expect(result.breathingRate).toBeCloseTo(16, 5);
  });

  it('returns null for a metric when all its values in the window are null', () => {
    const readings = [
      reading(1000, null, 12),
      reading(2000, null, 14),
      reading(3000, null, 16),
    ];
    // pulseRate: 0 valid values → null
    const result = computeBaseline(readings, 20000);
    expect(result.pulseRate).toBeNull();
    expect(result.breathingRate).toBeCloseTo(14, 5);
  });

  it('returns null for a metric when fewer than 3 non-null values exist', () => {
    const readings = [
      reading(1000, null, 12),  // pulse null
      reading(2000, null, 14),  // pulse null
      reading(3000, 80,  16),   // only 1 pulse value
    ];
    // pulseRate: only 1 valid → null
    const result = computeBaseline(readings, 20000);
    expect(result.pulseRate).toBeNull();
    expect(result.breathingRate).toBeCloseTo(14, 5);
  });
});
