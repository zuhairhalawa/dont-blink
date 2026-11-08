import { describe, it, expect } from 'vitest';
import {
  headAngles, eyesClosedScore, createHeadJudge, YAW_LIMIT, PITCH_LIMIT,
} from '../../kit/vitals/headTurn';

/** Column-major 4x4 for R = Ry(yaw) * Rx(pitch), angles in degrees. */
function pose(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  // Rows of R = Ry * Rx
  const R = [
    [cy, sy * sp, sy * cp],
    [0, cp, -sp],
    [-sy, cy * sp, cy * cp],
  ];
  const m = new Array(16).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = R[r]![c];
  m[15] = 1;
  return m;
}

describe('headAngles', () => {
  it('recovers yaw and pitch from the matrix', () => {
    const a = headAngles(pose(30, -10))!;
    expect(a.yaw).toBeCloseTo(30);
    expect(a.pitch).toBeCloseTo(-10);
    const b = headAngles(pose(-45, 15))!;
    expect(b.yaw).toBeCloseTo(-45);
    expect(b.pitch).toBeCloseTo(15);
  });

  it('returns null for missing or broken matrices', () => {
    expect(headAngles(null)).toBeNull();
    expect(headAngles([1, 2, 3])).toBeNull();
    expect(headAngles(new Array(16).fill(NaN))).toBeNull();
  });
});

describe('eyesClosedScore', () => {
  it('uses the less-closed eye, so winking does not count', () => {
    expect(eyesClosedScore([
      { categoryName: 'eyeBlinkLeft', score: 0.9 },
      { categoryName: 'eyeBlinkRight', score: 0.2 },
    ])).toBe(0.2);
    expect(eyesClosedScore([
      { categoryName: 'eyeBlinkLeft', score: 0.8 },
      { categoryName: 'eyeBlinkRight', score: 0.7 },
    ])).toBe(0.7);
  });

  it('returns null without both scores', () => {
    expect(eyesClosedScore(undefined)).toBeNull();
    expect(eyesClosedScore([{ categoryName: 'eyeBlinkLeft', score: 1 }])).toBeNull();
  });
});

describe('head judge', () => {
  const calibrated = () => {
    const j = createHeadJudge(5);
    for (let i = 0; i < 5; i++) j.push({ yaw: 4, pitch: -6 });
    return j;
  };

  it('learns the resting pose from the first frames', () => {
    expect(calibrated().rest).toEqual({ yaw: 4, pitch: -6 });
  });

  it('treats no face as away, even before calibration', () => {
    expect(createHeadJudge().push(null)).toBe(false);
  });

  it('allows small turns and flags big ones, both ways', () => {
    const j = calibrated();
    expect(j.push({ yaw: 4 + YAW_LIMIT - 1, pitch: -6 })).toBe(true);
    expect(j.push({ yaw: 4 + YAW_LIMIT + 2, pitch: -6 })).toBe(false);
    expect(j.push({ yaw: 4 - YAW_LIMIT - 2, pitch: -6 })).toBe(false);
    expect(j.push({ yaw: 4, pitch: -6 + PITCH_LIMIT + 2 })).toBe(false);
  });

  it('does not let a turned head drag the resting pose', () => {
    const j = calibrated();
    for (let i = 0; i < 200; i++) j.push({ yaw: 70, pitch: -6 });
    expect(j.rest!.yaw).toBeCloseTo(4);
  });

  it('forgets the resting pose on reset and learns it again', () => {
    const j = createHeadJudge(3);
    for (let i = 0; i < 3; i++) j.push({ yaw: 60, pitch: 0 });
    j.reset();
    expect(j.rest).toBeNull();
    for (let i = 0; i < 3; i++) j.push({ yaw: 0, pitch: 0 });
    expect(j.rest?.yaw).toBeCloseTo(0);
    expect(j.push({ yaw: 5, pitch: 0 })).toBe(true);
  });
});
