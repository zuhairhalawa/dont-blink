/**
 * kit/vitals/headTurn.ts
 *
 * Head direction and eye closure from MediaPipe Face Landmarker output.
 *
 *   headAngles():  yaw and pitch in degrees, from the facial transformation
 *                  matrix (the face model's rotation in camera space)
 *   eyesClosedScore(): how closed both eyes are (0-1), from the
 *                  eyeBlinkLeft / eyeBlinkRight blendshapes
 *   createHeadJudge(): learns the player's resting head angle and flags a
 *                  turn of more than YAW_LIMIT or a tilt past PITCH_LIMIT
 *
 * Play-test (Nov 2026): a nose-position ratio needed an almost 180-degree
 * turn to trigger, so angles replaced it.
 *
 * Pure functions, unit-tested.
 */

export interface HeadPose { yaw: number; pitch: number }

/** Turning further than this from the resting angle counts as looking away. */
export const YAW_LIMIT = 25;
/** Tilting further than this (up or down) counts as looking away. */
export const PITCH_LIMIT = 20;

/** Eyes count as closed above this score and open again below EYES_OPEN. */
export const EYES_CLOSED = 0.5;
export const EYES_OPEN = 0.35;

/**
 * Yaw and pitch in degrees from a 4x4 column-major transformation matrix.
 * For R = Ry(yaw) * Rx(pitch), the third column is
 * (sin yaw cos pitch, -sin pitch, cos yaw cos pitch).
 */
export function headAngles(m: ArrayLike<number> | null | undefined): HeadPose | null {
  if (!m || m.length < 16) return null;
  const r02 = m[8]!;
  const r12 = m[9]!;
  const r22 = m[10]!;
  if (![r02, r12, r22].every(Number.isFinite)) return null;
  const deg = 180 / Math.PI;
  return {
    yaw: Math.atan2(r02, r22) * deg,
    pitch: Math.asin(Math.max(-1, Math.min(1, -r12))) * deg,
  };
}

/** How closed both eyes are: the lower of the two eyeBlink scores (0 = open, 1 = shut). */
export function eyesClosedScore(categories: readonly { categoryName: string; score: number }[] | undefined): number | null {
  if (!categories) return null;
  const l = categories.find((c) => c.categoryName === 'eyeBlinkLeft')?.score;
  const r = categories.find((c) => c.categoryName === 'eyeBlinkRight')?.score;
  if (l === undefined || r === undefined) return null;
  return Math.min(l, r);
}

export interface HeadJudge {
  /**
   * Feed one frame's pose (null = no face found). Returns true when the
   * player is facing the screen, false when turned away or gone.
   */
  push(p: HeadPose | null): boolean;
  /** Resting pose learned so far, or null before calibration. */
  readonly rest: HeadPose | null;
  /** Forget the resting pose and learn it again from the next frames. */
  reset(): void;
}

/**
 * Learns the player's resting head pose from the first `calibFrames` faces
 * (median), then judges each frame against it. While facing the screen the
 * resting pose drifts slowly, so leaning a little over a game doesn't count.
 */
export function createHeadJudge(calibFrames = 15): HeadJudge {
  const yaws: number[] = [];
  const pitches: number[] = [];
  let rest: HeadPose | null = null;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  return {
    get rest() {
      return rest;
    },
    reset() {
      rest = null;
      yaws.length = 0;
      pitches.length = 0;
    },
    push(p) {
      if (p === null) return false;
      if (rest === null) {
        yaws.push(p.yaw);
        pitches.push(p.pitch);
        if (yaws.length >= calibFrames) rest = { yaw: median(yaws), pitch: median(pitches) };
        return true;
      }
      const facing = Math.abs(p.yaw - rest.yaw) <= YAW_LIMIT && Math.abs(p.pitch - rest.pitch) <= PITCH_LIMIT;
      if (facing) {
        rest = { yaw: rest.yaw * 0.995 + p.yaw * 0.005, pitch: rest.pitch * 0.995 + p.pitch * 0.005 };
      }
      return facing;
    },
  };
}
