/**
 * test/signal/smooth.test.ts
 *
 * Unit tests for smoothSeries (kit/signal/smooth.ts).
 * Covers all branches for 100% branch coverage.
 */

import { describe, it, expect } from 'vitest';
import { smoothSeries } from 'kit/signal';

describe('smoothSeries', () => {
  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('returns an empty array for an empty input', () => {
    expect(smoothSeries([], 3)).toEqual([]);
  });

  it('returns a single-element array unchanged', () => {
    expect(smoothSeries([42], 5)).toEqual([42]);
  });

  it('returns the original values when windowSize is 1', () => {
    const values = [1, 2, 3, 4, 5];
    expect(smoothSeries(values, 1)).toEqual(values);
  });

  it('returns the original values when windowSize is 0 (clamped to 1)', () => {
    const values = [10, 20, 30];
    expect(smoothSeries(values, 0)).toEqual(values);
  });

  it('returns the original values when windowSize is negative (clamped to 1)', () => {
    const values = [7, 8, 9];
    expect(smoothSeries(values, -3)).toEqual(values);
  });

  // -----------------------------------------------------------------------
  // Window larger than array length
  // -----------------------------------------------------------------------

  it('averages all values when windowSize exceeds array length', () => {
    // [2, 4, 6] → mean = 4; window half=5 so every element sees all 3
    const result = smoothSeries([2, 4, 6], 11);
    expect(result).toHaveLength(3);
    result.forEach((v) => expect(v).toBeCloseTo(4, 5));
  });

  it('handles window equal to array length', () => {
    // [1, 2, 3] window=3, half=1
    // index 0: [0..1] → (1+2)/2 = 1.5
    // index 1: [0..2] → (1+2+3)/3 = 2
    // index 2: [1..2] → (2+3)/2 = 2.5
    const result = smoothSeries([1, 2, 3], 3);
    expect(result[0]).toBeCloseTo(1.5, 5);
    expect(result[1]).toBeCloseTo(2, 5);
    expect(result[2]).toBeCloseTo(2.5, 5);
  });

  // -----------------------------------------------------------------------
  // Typical even-length array with odd window
  // -----------------------------------------------------------------------

  it('smooths a typical even-length array (window=3)', () => {
    // [10, 20, 30, 40] with window=3 (half=1)
    // i=0: [0..1] → (10+20)/2 = 15
    // i=1: [0..2] → (10+20+30)/3 ≈ 20
    // i=2: [1..3] → (20+30+40)/3 ≈ 30
    // i=3: [2..3] → (30+40)/2 = 35
    const result = smoothSeries([10, 20, 30, 40], 3);
    expect(result).toHaveLength(4);
    expect(result[0]).toBeCloseTo(15, 5);
    expect(result[1]).toBeCloseTo(20, 5);
    expect(result[2]).toBeCloseTo(30, 5);
    expect(result[3]).toBeCloseTo(35, 5);
  });

  it('does not mutate the original array', () => {
    const values = [1, 2, 3, 4, 5];
    const copy = [...values];
    smoothSeries(values, 3);
    expect(values).toEqual(copy);
  });

  // -----------------------------------------------------------------------
  // Even window size
  // -----------------------------------------------------------------------

  it('smooths correctly with an even window size (window=4, half=2)', () => {
    // [0, 10, 20, 30, 40, 50] with window=4, half=2
    // i=0: [0..2] → (0+10+20)/3 ≈ 10
    // i=1: [0..3] → (0+10+20+30)/4 = 15
    // i=2: [0..4] → (0+10+20+30+40)/5 = 20
    // i=3: [1..5] → (10+20+30+40+50)/5 = 30
    // i=4: [2..5] → (20+30+40+50)/4 = 35
    // i=5: [3..5] → (30+40+50)/3 ≈ 40
    const result = smoothSeries([0, 10, 20, 30, 40, 50], 4);
    expect(result).toHaveLength(6);
    expect(result[0]).toBeCloseTo(10, 5);
    expect(result[1]).toBeCloseTo(15, 5);
    expect(result[2]).toBeCloseTo(20, 5);
    expect(result[3]).toBeCloseTo(30, 5);
    expect(result[4]).toBeCloseTo(35, 5);
    expect(result[5]).toBeCloseTo(40, 5);
  });
});
