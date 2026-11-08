/**
 * kit/vitals/headTurn.ts
 *
 * Decides whether the player has turned their head away from the screen,
 * from MediaPipe Face Landmarker points (478-point face mesh, image space).
 *
 * Two ratios, each compared with the player's own resting value:
 *   yaw:   where the nose tip sits between the two cheek edges
 *          (0.5 = facing the camera, toward 0 or 1 = turned left or right)
 *   pitch: where the nose tip sits between forehead and chin
 *          (rises when looking down, falls when looking up)
 *
 * Pure functions, unit-tested with synthetic points.
 */

export interface Pt { x: number; y: number }

/** Face-mesh indices used. */
export const NOSE_TIP = 1;
export const CHEEK_LEFT = 234;
export const CHEEK_RIGHT = 454;
export const FOREHEAD = 10;
export const CHIN = 152;

/** Turn larger than this (change in yaw ratio) counts as looking away, about 30 degrees. */
export const YAW_LIMIT = 0.17;
/** Tilt larger than this (change in pitch ratio) counts as looking away. */
export const PITCH_LIMIT = 0.13;

export interface HeadRatios { yaw: number; pitch: number }

/** Compute the two ratios, or null if the points are missing or degenerate. */
export function headRatios(lm: readonly Pt[]): HeadRatios | null {
  const n = lm[NOSE_TIP];
  const l = lm[CHEEK_LEFT];
  const r = lm[CHEEK_RIGHT];
  const t = lm[FOREHEAD];
  const c = lm[CHIN];
  if (!n || !l || !r || !t || !c) return null;
  const w = r.x - l.x;
  const h = c.y - t.y;
  if (Math.abs(w) < 1e-6 || Math.abs(h) < 1e-6) return null;
  return { yaw: (n.x - l.x) / w, pitch: (n.y - t.y) / h };
}

export interface HeadJudge {
  /**
   * Feed one frame's ratios (null = no face found). Returns true when the
   * player is facing the screen, false when turned away or gone.
   */
  push(r: HeadRatios | null): boolean;
  /** Resting ratios learned so far, or null before calibration. */
  readonly rest: HeadRatios | null;
}

/**
 * Learns the player's resting head position from the first `calibFrames`
 * faces it sees (median), then judges each frame against it. While facing
 * the screen the resting position drifts slowly, so leaning a little over
 * a long game doesn't count as looking away.
 */
export function createHeadJudge(calibFrames = 15): HeadJudge {
  const yaws: number[] = [];
  const pitches: number[] = [];
  let rest: HeadRatios | null = null;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  return {
    get rest() {
      return rest;
    },
    push(r) {
      if (r === null) return false;
      if (rest === null) {
        yaws.push(r.yaw);
        pitches.push(r.pitch);
        if (yaws.length >= calibFrames) rest = { yaw: median(yaws), pitch: median(pitches) };
        return true;
      }
      const facing = Math.abs(r.yaw - rest.yaw) <= YAW_LIMIT && Math.abs(r.pitch - rest.pitch) <= PITCH_LIMIT;
      if (facing) {
        rest = { yaw: rest.yaw * 0.995 + r.yaw * 0.005, pitch: rest.pitch * 0.995 + r.pitch * 0.005 };
      }
      return facing;
    },
  };
}
