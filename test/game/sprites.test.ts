import { describe, it, expect } from 'vitest';
import { keyAlpha, despill } from '../../src/renderer/game/sprites';

describe('chroma key', () => {
  it('removes flat green and keeps the dark coat and pale mask', () => {
    expect(keyAlpha(0, 255, 0)).toBe(0);
    expect(keyAlpha(30, 200, 40)).toBe(0);
    expect(keyAlpha(25, 22, 20)).toBe(1); // charcoal coat
    expect(keyAlpha(230, 225, 215)).toBe(1); // porcelain mask
    expect(keyAlpha(120, 110, 100)).toBe(1); // grey skin
  });

  it('ramps softly at the edges', () => {
    const a = keyAlpha(100, 160, 90);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it('pulls green spill down to the brighter of red and blue', () => {
    expect(despill(100, 160, 90)).toBe(100);
    expect(despill(200, 150, 120)).toBe(150);
  });
});
