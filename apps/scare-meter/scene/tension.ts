/**
 * apps/scare-meter/scene/tension.ts
 *
 * Turns the live pulse into a 0-1 "tension" value that the scene uses for the
 * vignette and the drone volume, so the room visibly closes in as the
 * player's pulse rises above their resting rate.
 */

/** Pulse rise above baseline (in percent) that maps to full tension. */
export const FULL_TENSION_PCT = 20;

/**
 * Map the current pulse to tension.
 *
 * tension = clamp((pulse - baseline) / baseline * 100 / FULL_TENSION_PCT, 0, 1)
 *
 * Returns 0 when either value is missing or the baseline is not positive,
 * so a missing reading never makes the scene jump.
 */
export function tensionFromPulse(pulse: number | null, baseline: number | null): number {
  if (pulse === null || baseline === null || baseline <= 0) return 0;
  const pct = ((pulse - baseline) / baseline) * 100;
  const t = pct / FULL_TENSION_PCT;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

/**
 * Move `current` a fraction of the way toward `target`. Called every frame so
 * tension changes glide instead of stepping when a new reading arrives.
 *
 * @param rate  Fraction per frame, between 0 and 1.
 */
export function easeToward(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}
