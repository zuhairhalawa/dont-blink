/**
 * kit/signal/smooth.ts
 *
 * Rolling-average smoothing for a series of numeric values.
 * Pure function — no side effects, no external dependencies.
 */

/**
 * Apply a rolling (simple moving) average to `values` with the given
 * `windowSize`.
 *
 * Edge behaviour: when fewer than `windowSize` samples are available at
 * either end, the window is centred on the available samples (i.e. we do
 * not pad with zeros or mirror). Concretely, for index `i` the window spans
 * indices `max(0, i - half) … min(n-1, i + half)` where
 * `half = Math.floor(windowSize / 2)`.
 *
 * Special cases:
 *  - Empty array → empty array.
 *  - Single value → same single value.
 *  - windowSize ≤ 1 → values returned unchanged (no smoothing).
 *  - windowSize > array length → single average replaces every element.
 *
 * @param values     The input series.
 * @param windowSize Number of samples to include in each average (positive
 *                   integer; clamped to 1 if ≤ 0).
 * @returns          A new array of the same length with smoothed values.
 */
export function smoothSeries(values: number[], windowSize: number): number[] {
  // Edge case: nothing to smooth
  if (values.length === 0) {
    return [];
  }

  // Clamp window to at least 1 so we never divide by zero
  const w = Math.max(1, Math.floor(windowSize));

  // No smoothing needed
  if (w <= 1) {
    return values.slice();
  }

  const n = values.length;
  const half = Math.floor(w / 2);
  const result = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      // values[j] is always defined here because j is in [0, n-1]
      sum += values[j] as number;
    }
    result[i] = sum / (hi - lo + 1);
  }

  return result;
}
