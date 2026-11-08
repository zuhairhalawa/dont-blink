import { describe, it, expect } from 'vitest';
import { placeWatcher, faceToScreen, maskHeightAt, STEP_DEPTHS } from '../../src/renderer/game/room';
import { MASK_CENTRE_UP, MASK_HEIGHT } from '../../src/renderer/game/corridor';

const W = 1600;
const H = 900;
const maskCentre = (p: { footY: number; s: number }) => p.footY - MASK_CENTRE_UP * p.s;
const maskPx = (p: { s: number }) => p.s * MASK_HEIGHT;
const face = { cx: 0.6, cy: 0.45, w: 0.18, h: 0.3 };

describe('placeWatcher (perspective)', () => {
  it('comes from the side with more room', () => {
    expect(placeWatcher(0, face, W, H).side).toBe(-1);
    expect(placeWatcher(0, { cx: 0.3, cy: 0.5, w: 0.2, h: 0.3 }, W, H).side).toBe(1);
  });

  it('gets clearly bigger at every step, by at least 15 percent', () => {
    let last = 0;
    for (let k = 0; k <= 7; k++) {
      const m = maskPx(placeWatcher(k, face, W, H));
      if (k > 0) expect(m).toBeGreaterThan(last * 1.15);
      last = m;
    }
  });

  it('stands on the floor: its feet drop down the frame as it comes closer', () => {
    const f0 = placeWatcher(0, face, W, H).footY;
    const f2 = placeWatcher(2, face, W, H).footY;
    const f4 = placeWatcher(4, face, W, H).footY;
    expect(f0).toBeLessThan(H);
    expect(f2).toBeGreaterThan(f0);
    expect(f4).toBeGreaterThan(f2);
  });

  it('keeps its mask on screen while it approaches', () => {
    for (let k = 0; k <= 7; k++) {
      const y = maskCentre(placeWatcher(k, face, W, H));
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(H);
    }
  });

  it('lands in a different spot every step', () => {
    const xs = [0, 1, 2, 3, 4, 5].map((k) => placeWatcher(k, face, W, H).fx);
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i]! - xs[i - 1]!)).toBeGreaterThan(20);
  });

  it('ends behind the shoulder, bigger than the face, then lunges to the centre', () => {
    const p7 = placeWatcher(7, face, W, H);
    expect(maskPx(p7)).toBeGreaterThan(face.h * H);
    expect(p7.fx).toBeLessThan(face.cx * W);
    const p8 = placeWatcher(8, face, W, H);
    expect(p8.fx).toBeCloseTo(W / 2);
    expect(maskCentre(p8)).toBeCloseTo(H / 2);
    expect(maskPx(p8)).toBeGreaterThan(H);
  });

  it('reports depth that falls step by step', () => {
    for (let k = 1; k <= 7; k++) {
      expect(placeWatcher(k, face, W, H).depth).toBeLessThan(placeWatcher(k - 1, face, W, H).depth);
    }
    expect(placeWatcher(0, face, W, H).depth).toBe(STEP_DEPTHS[0]);
  });

  it('stoops as it closes in', () => {
    expect(maskHeightAt(4)).toBeCloseTo(1.85);
    expect(maskHeightAt(1)).toBeCloseTo(1.2);
    expect(maskHeightAt(2)).toBeLessThan(maskHeightAt(3));
  });

  it('copes with no face', () => {
    const p = placeWatcher(3, null, W, H);
    expect(Number.isFinite(p.fx) && Number.isFinite(p.footY) && p.s > 0).toBe(true);
  });
});

describe('faceToScreen', () => {
  it('mirrors x and accounts for cover cropping', () => {
    const f = faceToScreen({ cx: 0.3, cy: 0.4, w: 0.2, h: 0.3 }, 1280, 720, 1600, 900);
    expect(f.cx).toBeCloseTo(0.7);
    expect(f.cy).toBeCloseTo(0.4);
    expect(f.w).toBeCloseTo(0.2);
    const g = faceToScreen({ cx: 0.5, cy: 0.5, w: 0.2, h: 0.3 }, 1280, 720, 1200, 900);
    expect(g.cx).toBeCloseTo(0.5);
    expect(g.w).toBeGreaterThan(0.2);
  });
});
