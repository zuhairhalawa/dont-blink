/**
 * test/signal/change.test.ts
 *
 * Unit tests for computeChange and detectBeatChange (kit/signal/change.ts).
 * Covers all branches for 100% branch coverage.
 */

import { describe, it, expect } from 'vitest';
import { computeChange, detectBeatChange } from 'kit/signal';
import type { VitalsReading, Baseline } from 'kit/vitals/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reading(
  timestamp: number,
  pulseRate: number | null,
  breathingRate: number | null,
  valid = true,
): VitalsReading {
  return { timestamp, pulseRate, breathingRate, valid };
}

// ---------------------------------------------------------------------------
// computeChange
// ---------------------------------------------------------------------------

describe('computeChange', () => {
  it('returns null when baseline is zero (division by zero)', () => {
    expect(computeChange(80, 0)).toBeNull();
  });

  it('returns 0 when current equals baseline', () => {
    expect(computeChange(70, 70)).toBeCloseTo(0, 5);
  });

  it('computes a positive percentage when current > baseline', () => {
    // (80 - 70) / 70 * 100 ≈ 14.286%
    expect(computeChange(80, 70)).toBeCloseTo(14.2857, 3);
  });

  it('computes a negative percentage when current < baseline', () => {
    // (60 - 70) / 70 * 100 ≈ -14.286%
    expect(computeChange(60, 70)).toBeCloseTo(-14.2857, 3);
  });

  it('handles fractional values correctly', () => {
    // (15 - 12) / 12 * 100 = 25%
    expect(computeChange(15, 12)).toBeCloseTo(25, 5);
  });
});

// ---------------------------------------------------------------------------
// detectBeatChange
// ---------------------------------------------------------------------------

describe('detectBeatChange', () => {
  // -----------------------------------------------------------------------
  // Null baseline
  // -----------------------------------------------------------------------

  it('returns all null deltas when both baseline fields are null', () => {
    const readings = [
      reading(1000, 80, 18),
      reading(2000, 82, 20),
    ];
    const baseline: Baseline = { pulseRate: null, breathingRate: null };
    const result = detectBeatChange(readings, 5000, baseline);
    expect(result.pulseDeltaBpm).toBeNull();
    expect(result.pulseDeltaPct).toBeNull();
    expect(result.breathingDeltaBpm).toBeNull();
    expect(result.breathingDeltaPct).toBeNull();
  });

  it('returns null pulse deltas when only pulse baseline is null', () => {
    const readings = [reading(1000, 80, 18), reading(2000, 82, 20)];
    const baseline: Baseline = { pulseRate: null, breathingRate: 15 };
    const result = detectBeatChange(readings, 5000, baseline);
    expect(result.pulseDeltaBpm).toBeNull();
    expect(result.pulseDeltaPct).toBeNull();
    // breathing: mean = (18+20)/2 = 19; delta = 19-15 = 4; pct = 4/15*100 ≈ 26.67
    expect(result.breathingDeltaBpm).toBeCloseTo(4, 5);
    expect(result.breathingDeltaPct).toBeCloseTo((4 / 15) * 100, 3);
  });

  it('returns null breathing deltas when only breathing baseline is null', () => {
    const readings = [reading(1000, 80, 18), reading(2000, 82, 20)];
    const baseline: Baseline = { pulseRate: 70, breathingRate: null };
    const result = detectBeatChange(readings, 5000, baseline);
    expect(result.breathingDeltaBpm).toBeNull();
    expect(result.breathingDeltaPct).toBeNull();
    // pulse: mean = (80+82)/2 = 81; delta = 81-70 = 11; pct = 11/70*100 ≈ 15.71
    expect(result.pulseDeltaBpm).toBeCloseTo(11, 5);
    expect(result.pulseDeltaPct).toBeCloseTo((11 / 70) * 100, 3);
  });

  // -----------------------------------------------------------------------
  // Zero baseline (computeChange returns null for that metric's pct)
  // -----------------------------------------------------------------------

  it('returns null percentage when baseline is zero for a metric', () => {
    const readings = [reading(1000, 80, 18)];
    const baseline: Baseline = { pulseRate: 0, breathingRate: 15 };
    const result = detectBeatChange(readings, 5000, baseline);
    // pulseDeltaBpm: 80 - 0 = 80
    expect(result.pulseDeltaBpm).toBeCloseTo(80, 5);
    // pulseDeltaPct: computeChange(80, 0) = null
    expect(result.pulseDeltaPct).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Normal case
  // -----------------------------------------------------------------------

  it('computes correct deltas in the normal case', () => {
    // Readings: pulse mean = (70+80+90)/3 ≈ 80, breathing mean = (12+16+20)/3 ≈ 16
    // Baseline: pulse=70, breathing=12
    const readings = [
      reading(1000, 70, 12),
      reading(2000, 80, 16),
      reading(3000, 90, 20),
    ];
    const baseline: Baseline = { pulseRate: 70, breathingRate: 12 };
    const result = detectBeatChange(readings, 10000, baseline);
    expect(result.pulseDeltaBpm).toBeCloseTo(10, 5);
    expect(result.pulseDeltaPct).toBeCloseTo((10 / 70) * 100, 3);
    expect(result.breathingDeltaBpm).toBeCloseTo(4, 5);
    expect(result.breathingDeltaPct).toBeCloseTo((4 / 12) * 100, 3);
  });

  // -----------------------------------------------------------------------
  // Mixed null inputs in readings
  // -----------------------------------------------------------------------

  it('ignores null pulseRate values in readings when computing mean', () => {
    const readings = [
      reading(1000, null, 15),  // pulse null → excluded
      reading(2000, 80,  17),
      reading(3000, 90,  19),
    ];
    const baseline: Baseline = { pulseRate: 70, breathingRate: 15 };
    const result = detectBeatChange(readings, 10000, baseline);
    // pulse mean = (80+90)/2 = 85; delta = 15
    expect(result.pulseDeltaBpm).toBeCloseTo(15, 5);
    expect(result.pulseDeltaPct).toBeCloseTo((15 / 70) * 100, 3);
  });

  it('ignores null breathingRate values in readings when computing mean', () => {
    const readings = [
      reading(1000, 80, null),  // breathing null → excluded
      reading(2000, 82, 18),
      reading(3000, 84, 20),
    ];
    const baseline: Baseline = { pulseRate: 70, breathingRate: 15 };
    const result = detectBeatChange(readings, 10000, baseline);
    // breathing mean = (18+20)/2 = 19; delta = 4
    expect(result.breathingDeltaBpm).toBeCloseTo(4, 5);
    expect(result.breathingDeltaPct).toBeCloseTo((4 / 15) * 100, 3);
  });

  it('returns null deltas when all pulse readings in the window are null', () => {
    const readings = [
      reading(1000, null, 18),
      reading(2000, null, 20),
    ];
    const baseline: Baseline = { pulseRate: 70, breathingRate: 15 };
    const result = detectBeatChange(readings, 10000, baseline);
    expect(result.pulseDeltaBpm).toBeNull();
    expect(result.pulseDeltaPct).toBeNull();
    // breathing still computed
    expect(result.breathingDeltaBpm).not.toBeNull();
  });

  it('returns null deltas when all breathing readings in the window are null', () => {
    const readings = [
      reading(1000, 80, null),
      reading(2000, 82, null),
    ];
    const baseline: Baseline = { pulseRate: 70, breathingRate: 15 };
    const result = detectBeatChange(readings, 10000, baseline);
    expect(result.breathingDeltaBpm).toBeNull();
    expect(result.breathingDeltaPct).toBeNull();
    // pulse still computed
    expect(result.pulseDeltaBpm).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Window filtering
  // -----------------------------------------------------------------------

  it('only considers readings within the windowMs', () => {
    // Latest = 5000; window = 2000 → start = 3000
    // Only readings at t=3000, t=4000, t=5000 are included
    const readings = [
      reading(1000, 50, 10),  // outside → ignored
      reading(2000, 55, 11),  // outside → ignored
      reading(3000, 80, 18),  // inside
      reading(4000, 82, 20),  // inside
      reading(5000, 84, 22),  // inside (latest)
    ];
    const baseline: Baseline = { pulseRate: 70, breathingRate: 15 };
    const result = detectBeatChange(readings, 2000, baseline);
    // pulse mean = (80+82+84)/3 ≈ 82; delta = 12
    expect(result.pulseDeltaBpm).toBeCloseTo(12, 5);
    // breathing mean = (18+20+22)/3 = 20; delta = 5
    expect(result.breathingDeltaBpm).toBeCloseTo(5, 5);
  });

  it('returns all null deltas when readings array is empty', () => {
    const baseline: Baseline = { pulseRate: 70, breathingRate: 15 };
    const result = detectBeatChange([], 10000, baseline);
    expect(result.pulseDeltaBpm).toBeNull();
    expect(result.pulseDeltaPct).toBeNull();
    expect(result.breathingDeltaBpm).toBeNull();
    expect(result.breathingDeltaPct).toBeNull();
  });
});
