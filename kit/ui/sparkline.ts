/**
 * kit/ui/sparkline.ts
 *
 * Pure functions for sparkline coordinate and scale calculation.
 * Kept separate from LiveReadout.ts so they can be unit-tested without a DOM.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single plotted point: condensed x-index and actual value. */
export interface SparkPoint {
  /** 0-based index within the non-null subset (used for the x-coordinate). */
  condensedIdx: number;
  /** Original position in the history buffer (used to detect gaps). */
  histIdx: number;
  value: number;
}

/** Scale information for the y-axis. */
export interface SparkScale {
  lo: number;
  range: number;
}

// ---------------------------------------------------------------------------
// filterNonNull
// ---------------------------------------------------------------------------

/**
 * Return all non-null entries from `history`, preserving their original
 * buffer index so callers can detect gaps.
 *
 * @param history  Ring-buffer of readings (may contain nulls).
 */
export function filterNonNull(history: (number | null)[]): SparkPoint[] {
  const result: SparkPoint[] = [];
  for (let i = 0; i < history.length; i++) {
    const v = history[i];
    if (v !== null && v !== undefined) {
      result.push({ condensedIdx: result.length, histIdx: i, value: v });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// computeSparkScale
// ---------------------------------------------------------------------------

/**
 * Compute y-axis scale (lo, range) for the given non-null points.
 *
 * A 5 % padding is added above and below the min/max so:
 *   - the line never hugs the SVG edges, and
 *   - a perfectly flat signal renders as a centred horizontal line rather
 *     than being clipped to the very bottom of the viewport.
 *
 * When all values are identical the raw range is 0; the padding defaults to 1
 * to prevent division-by-zero.
 *
 * @param points  Array returned by filterNonNull (must have length >= 1).
 */
export function computeSparkScale(points: SparkPoint[]): SparkScale {
  const vals   = points.map(p => p.value);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const rawRange = maxVal - minVal;
  const padding  = rawRange > 0 ? rawRange * 0.05 : 1;
  const lo       = minVal - padding;
  const range    = rawRange + padding * 2 || 1; // guard against 0
  return { lo, range };
}

// ---------------------------------------------------------------------------
// buildSparkSegments
// ---------------------------------------------------------------------------

/**
 * Group `points` into contiguous segments, breaking whenever there is at
 * least one null slot between two consecutive non-null entries in the original
 * history buffer.
 *
 * Each segment is an array of SparkPoint values that should be drawn as a
 * connected polyline.  A segment with fewer than two points is not returned
 * (it cannot form a visible line).
 *
 * @param points  Array returned by filterNonNull (already has histIdx).
 */
export function buildSparkSegments(points: SparkPoint[]): SparkPoint[][] {
  if (points.length === 0) return [];

  const segments: SparkPoint[][] = [];
  // Indices below are always in range (i starts at 1, and length > 0 is checked above),
  // so the non-null assertions only satisfy noUncheckedIndexedAccess.
  let current: SparkPoint[] = [points[0]!];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    // A gap exists when the history-buffer indices are not consecutive.
    if (curr.histIdx !== prev.histIdx + 1) {
      if (current.length >= 2) segments.push(current);
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  if (current.length >= 2) segments.push(current);

  return segments;
}
