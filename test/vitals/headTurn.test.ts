import { describe, it, expect } from 'vitest';
import {
  headRatios, createHeadJudge, NOSE_TIP, CHEEK_LEFT, CHEEK_RIGHT, FOREHEAD, CHIN, YAW_LIMIT, PITCH_LIMIT, type Pt,
} from '../../kit/vitals/headTurn';

/** A synthetic 478-point mesh with only the five points we use set. */
function face(noseX: number, noseY: number): Pt[] {
  const lm: Pt[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lm[CHEEK_LEFT] = { x: 0.4, y: 0.5 };
  lm[CHEEK_RIGHT] = { x: 0.6, y: 0.5 };
  lm[FOREHEAD] = { x: 0.5, y: 0.35 };
  lm[CHIN] = { x: 0.5, y: 0.65 };
  lm[NOSE_TIP] = { x: noseX, y: noseY };
  return lm;
}

describe('headRatios', () => {
  it('is 0.5 / 0.5 for a centred nose', () => {
    expect(headRatios(face(0.5, 0.5))).toEqual({ yaw: 0.5, pitch: 0.5 });
  });

  it('moves toward 0 or 1 as the head turns', () => {
    expect(headRatios(face(0.43, 0.5))!.yaw).toBeCloseTo(0.15);
    expect(headRatios(face(0.58, 0.5))!.yaw).toBeCloseTo(0.9);
  });

  it('returns null for missing or degenerate points', () => {
    expect(headRatios([])).toBeNull();
    const flat = face(0.5, 0.5);
    flat[CHEEK_RIGHT] = { x: 0.4, y: 0.5 };
    expect(headRatios(flat)).toBeNull();
  });
});

describe('head judge', () => {
  const calibrated = () => {
    const j = createHeadJudge(5);
    for (let i = 0; i < 5; i++) j.push({ yaw: 0.52, pitch: 0.5 });
    return j;
  };

  it('learns the resting position from the first frames', () => {
    const j = calibrated();
    expect(j.rest).toEqual({ yaw: 0.52, pitch: 0.5 });
  });

  it('treats no face as away, even before calibration', () => {
    expect(createHeadJudge().push(null)).toBe(false);
  });

  it('allows small turns and flags big ones, both ways', () => {
    const j = calibrated();
    expect(j.push({ yaw: 0.52 + YAW_LIMIT - 0.01, pitch: 0.5 })).toBe(true);
    expect(j.push({ yaw: 0.52 + YAW_LIMIT + 0.02, pitch: 0.5 })).toBe(false);
    expect(j.push({ yaw: 0.52 - YAW_LIMIT - 0.02, pitch: 0.5 })).toBe(false);
    expect(j.push({ yaw: 0.52, pitch: 0.5 + PITCH_LIMIT + 0.02 })).toBe(false);
  });

  it('does not let a turned head drag the resting position', () => {
    const j = calibrated();
    for (let i = 0; i < 200; i++) j.push({ yaw: 0.9, pitch: 0.5 });
    expect(j.rest!.yaw).toBeCloseTo(0.52);
  });
});

describe('head judge reset', () => {
  it('forgets the resting position and learns it again', () => {
    const j = createHeadJudge(3);
    for (let i = 0; i < 3; i++) j.push({ yaw: 0.9, pitch: 0.5 });
    expect(j.rest?.yaw).toBeCloseTo(0.9);
    j.reset();
    expect(j.rest).toBeNull();
    for (let i = 0; i < 3; i++) j.push({ yaw: 0.5, pitch: 0.5 });
    expect(j.rest?.yaw).toBeCloseTo(0.5);
    expect(j.push({ yaw: 0.52, pitch: 0.5 })).toBe(true);
  });
});
