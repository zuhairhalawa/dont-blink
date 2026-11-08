/**
 * test/signal/sparkline.test.ts
 *
 * Unit tests for the pure sparkline helpers in kit/ui/sparkline.ts.
 *
 * Scenarios:
 *   filterNonNull
 *     - empty history → []
 *     - all nulls → []
 *     - all non-null → every entry preserved with correct histIdx
 *     - mixed: nulls skipped; histIdx reflects original buffer position
 *     - undefined slots treated as null (sparse array)
 *
 *   computeSparkScale
 *     - all identical values → lo = value − 1, range = 2 (flat-line padding)
 *     - spread values → 5 % padding applied above and below
 *     - two values: min and max match expected lo / range
 *
 *   buildSparkSegments
 *     - fewer than 2 points → no segments returned
 *     - all consecutive (no gaps) → one segment
 *     - single null gap in the middle → two segments
 *     - multiple null gaps → multiple segments
 *     - segment with only one point (isolated value) is dropped
 *     - first segment of length 1 followed by a segment of length ≥ 2
 */

import { describe, it, expect } from 'vitest';
import {
  filterNonNull,
  computeSparkScale,
  buildSparkSegments,
  type SparkPoint,
} from 'kit/ui/sparkline';

// ---------------------------------------------------------------------------
// filterNonNull
// ---------------------------------------------------------------------------

describe('filterNonNull', () => {
  it('returns [] for an empty history', () => {
    expect(filterNonNull([])).toEqual([]);
  });

  it('returns [] when every slot is null', () => {
    expect(filterNonNull([null, null, null])).toEqual([]);
  });

  it('returns all entries when there are no nulls', () => {
    const result = filterNonNull([10, 20, 30]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ condensedIdx: 0, histIdx: 0, value: 10 });
    expect(result[1]).toEqual({ condensedIdx: 1, histIdx: 1, value: 20 });
    expect(result[2]).toEqual({ condensedIdx: 2, histIdx: 2, value: 30 });
  });

  it('skips nulls and preserves original histIdx', () => {
    // history: [null, 10, null, null, 20, null, 30]
    //           idx0  idx1 idx2  idx3  idx4  idx5  idx6
    const result = filterNonNull([null, 10, null, null, 20, null, 30]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ condensedIdx: 0, histIdx: 1, value: 10 });
    expect(result[1]).toEqual({ condensedIdx: 1, histIdx: 4, value: 20 });
    expect(result[2]).toEqual({ condensedIdx: 2, histIdx: 6, value: 30 });
  });

  it('treats undefined slots as null', () => {
    // Sparse array: index 1 is undefined
    const history: (number | null)[] = [5];
    history[2] = 7; // index 1 is implicitly undefined
    const result = filterNonNull(history);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ condensedIdx: 0, histIdx: 0, value: 5 });
    expect(result[1]).toEqual({ condensedIdx: 1, histIdx: 2, value: 7 });
  });

  it('includes 0 as a valid value (not treated as null)', () => {
    const result = filterNonNull([0, null, 1]);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(0);
    expect(result[1].value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeSparkScale
// ---------------------------------------------------------------------------

describe('computeSparkScale', () => {
  function pts(values: number[]): SparkPoint[] {
    return values.map((v, i) => ({ condensedIdx: i, histIdx: i, value: v }));
  }

  it('uses padding of 1 when all values are identical (flat-line case)', () => {
    const { lo, range } = computeSparkScale(pts([70, 70, 70]));
    // rawRange = 0 → padding = 1; lo = 70 − 1 = 69; range = 0 + 1*2 = 2
    expect(lo).toBeCloseTo(69);
    expect(range).toBeCloseTo(2);
  });

  it('applies 5 % padding to a spread of values', () => {
    // min = 60, max = 80, rawRange = 20
    // padding = 20 * 0.05 = 1; lo = 60 − 1 = 59; range = 20 + 2 = 22
    const { lo, range } = computeSparkScale(pts([60, 70, 80]));
    expect(lo).toBeCloseTo(59);
    expect(range).toBeCloseTo(22);
  });

  it('maps min value to top of padding zone (lo = min − padding)', () => {
    const { lo } = computeSparkScale(pts([100, 200]));
    // rawRange = 100, padding = 5; lo = 100 − 5 = 95
    expect(lo).toBeCloseTo(95);
  });

  it('range covers min-to-max plus 2× padding', () => {
    const { range } = computeSparkScale(pts([100, 200]));
    // rawRange = 100, padding = 5; range = 100 + 10 = 110
    expect(range).toBeCloseTo(110);
  });

  it('works with a single point', () => {
    // Only one non-null point: rawRange = 0 → flat-line padding
    const { lo, range } = computeSparkScale(pts([55]));
    expect(lo).toBeCloseTo(54);
    expect(range).toBeCloseTo(2);
  });
});

// ---------------------------------------------------------------------------
// buildSparkSegments
// ---------------------------------------------------------------------------

describe('buildSparkSegments', () => {
  function pts(histIdxAndValues: [number, number][]): SparkPoint[] {
    return histIdxAndValues.map(([histIdx, value], condensedIdx) => ({
      condensedIdx,
      histIdx,
      value,
    }));
  }

  it('returns [] for an empty points array', () => {
    expect(buildSparkSegments([])).toEqual([]);
  });

  it('returns [] for a single point (cannot form a line)', () => {
    expect(buildSparkSegments(pts([[0, 10]]))).toEqual([]);
  });

  it('returns one segment when all points are consecutive (no gaps)', () => {
    // histIdx 0,1,2 — all adjacent
    const segments = buildSparkSegments(pts([[0, 10], [1, 20], [2, 30]]));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
  });

  it('splits into two segments when there is a null gap in the middle', () => {
    // histIdx 0,1 then gap (missing 2), then 3,4
    const segments = buildSparkSegments(pts([[0, 10], [1, 20], [3, 30], [4, 40]]));
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2); // histIdx 0,1
    expect(segments[1]).toHaveLength(2); // histIdx 3,4
  });

  it('produces multiple segments for multiple gaps', () => {
    // Gaps between 1→3 and 4→6
    const segments = buildSparkSegments(pts([
      [0, 1], [1, 2],   // segment 1
      [3, 3], [4, 4],   // segment 2
      [6, 5], [7, 6],   // segment 3
    ]));
    expect(segments).toHaveLength(3);
  });

  it('drops an isolated point (length-1 segment) between gaps', () => {
    // histIdx 0,1 | gap | 3 (isolated) | gap | 5,6
    const segments = buildSparkSegments(pts([
      [0, 10], [1, 20],  // will form a segment
      [3, 30],            // isolated — should be dropped
      [5, 40], [6, 50],  // will form a segment
    ]));
    expect(segments).toHaveLength(2);
    // Verify the two kept segments each have 2 points
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(2);
  });

  it('includes the first point of the next segment correctly after a gap', () => {
    const segments = buildSparkSegments(pts([[0, 10], [1, 20], [5, 99], [6, 88]]));
    expect(segments[1][0].histIdx).toBe(5);
    expect(segments[1][0].value).toBe(99);
  });

  it('condensedIdx values are sequential across segments', () => {
    const points = pts([[0, 1], [1, 2], [3, 3], [4, 4]]);
    const segments = buildSparkSegments(points);
    // condensedIdx for segment[0] should be 0,1 and segment[1] should be 2,3
    expect(segments[0][0].condensedIdx).toBe(0);
    expect(segments[0][1].condensedIdx).toBe(1);
    expect(segments[1][0].condensedIdx).toBe(2);
    expect(segments[1][1].condensedIdx).toBe(3);
  });
});
