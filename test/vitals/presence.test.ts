import { describe, it, expect } from 'vitest';
import { createPresenceFilter } from '../../kit/vitals/presence';

describe('presence filter', () => {
  it('starts present and ignores a brief miss', () => {
    const f = createPresenceFilter(450, 250);
    expect(f.present).toBe(true);
    expect(f.push(false, 0)).toBeNull();
    expect(f.push(false, 300)).toBeNull();
    expect(f.push(true, 400)).toBeNull();
    expect(f.present).toBe(true);
  });

  it('reports away after goneAfterMs of absence, and back after backAfterMs', () => {
    const f = createPresenceFilter(450, 250);
    f.push(false, 1000);
    expect(f.push(false, 1449)).toBeNull();
    expect(f.push(false, 1450)).toBe(false);
    expect(f.push(false, 1600)).toBeNull();
    expect(f.push(true, 2000)).toBeNull();
    expect(f.push(true, 2250)).toBe(true);
    expect(f.present).toBe(true);
  });

  it('restarts the timer when samples flip back', () => {
    const f = createPresenceFilter(450, 250);
    f.push(false, 0);
    f.push(true, 200);
    f.push(false, 300);
    expect(f.push(false, 700)).toBeNull();
    expect(f.push(false, 750)).toBe(false);
  });
});
