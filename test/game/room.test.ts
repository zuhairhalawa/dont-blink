import { describe, it, expect } from 'vitest';
import { placeWatcher, faceToScreen } from '../../src/renderer/game/room';
import { MASK_CENTRE_UP, MASK_HEIGHT } from '../../src/renderer/game/corridor';

const W = 1600;
const H = 900;
const maskCentre = (p: { footY: number; s: number }) => p.footY - MASK_CENTRE_UP * p.s;
const maskPx = (p: { s: number }) => p.s * MASK_HEIGHT;

describe('placeWatcher', () => {
  const face = { cx: 0.6, cy: 0.45, w: 0.18, h: 0.3 };

  it('starts small in the background, on the side with more room', () => {
    const p = placeWatcher(0, face, W, H);
    expect(p.side).toBe(-1);
    expect(p.fx).toBeCloseTo(0.13 * W);
    expect(maskPx(p)).toBeCloseTo(0.06 * H);
  });

  it('grows every step and ends behind the shoulder, bigger than the face', () => {
    let last = 0;
    for (let k = 0; k <= 7; k++) {
      const m = maskPx(placeWatcher(k, face, W, H));
      expect(m).toBeGreaterThan(last);
      last = m;
    }
    const p7 = placeWatcher(7, face, W, H);
    expect(p7.fx).toBeCloseTo((0.6 - 0.18 * 0.95) * W);
    expect(maskCentre(p7)).toBeCloseTo((0.45 - 0.3 * 0.3) * H);
    expect(maskPx(p7)).toBeGreaterThan(face.h * H);
  });

  it('lunges to the centre at step 8', () => {
    const p = placeWatcher(8, face, W, H);
    expect(p.fx).toBeCloseTo(W / 2);
    expect(maskCentre(p)).toBeCloseTo(H / 2);
    expect(maskPx(p)).toBeGreaterThan(H);
  });

  it('comes from the right when the player sits on the left, and copes with no face', () => {
    expect(placeWatcher(0, { cx: 0.3, cy: 0.5, w: 0.2, h: 0.3 }, W, H).side).toBe(1);
    const p = placeWatcher(3, null, W, H);
    expect(Number.isFinite(p.fx) && Number.isFinite(p.footY) && p.s > 0).toBe(true);
  });
});

describe('faceToScreen', () => {
  it('mirrors x and accounts for cover cropping', () => {
    // A 16:9 camera on a 16:9 screen: no crop, just the mirror.
    const f = faceToScreen({ cx: 0.3, cy: 0.4, w: 0.2, h: 0.3 }, 1280, 720, 1600, 900);
    expect(f.cx).toBeCloseTo(0.7);
    expect(f.cy).toBeCloseTo(0.4);
    expect(f.w).toBeCloseTo(0.2);
    // A 4:3 screen crops the sides of a 16:9 camera, so the face looks wider.
    const g = faceToScreen({ cx: 0.5, cy: 0.5, w: 0.2, h: 0.3 }, 1280, 720, 1200, 900);
    expect(g.cx).toBeCloseTo(0.5);
    expect(g.w).toBeGreaterThan(0.2);
  });
});
