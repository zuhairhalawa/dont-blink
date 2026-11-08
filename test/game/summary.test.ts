import { describe, it, expect } from 'vitest';
import { createGame, startGame, onBlink, onFace, tick, ROUND_MS, CAUGHT_STEP } from '../../src/renderer/game/rules';
import { summarize, clock, thin, type Sample } from '../../src/renderer/game/summary';

const T0 = 5_000_000;

describe('summarize', () => {
  it('summarises a survived round', () => {
    let g = startGame(createGame(), T0);
    g = onBlink(g, T0 + 5_000);
    g = onFace(g, false, T0 + 20_000);
    g = onFace(g, true, T0 + 21_000);
    g = onBlink(g, T0 + 30_000);
    g = tick(g, T0 + ROUND_MS);
    const samples: Sample[] = [
      { t: 2_000, pulse: 80, breathing: null },
      { t: 8_000, pulse: 84, breathing: 14 },
      { t: 31_000, pulse: 97, breathing: 18 },
      { t: 70_000, pulse: 150, breathing: null }, // after the round: ignored
    ];
    const s = summarize(g, samples);
    expect(s.outcome).toBe('survived');
    expect(s.durationMs).toBe(ROUND_MS);
    expect(s.blinks).toBe(2);
    expect(s.lookAways).toBe(1);
    expect(s.blinkTimes).toEqual([5_000, 30_000]);
    expect(s.longestStareMs).toBe(30_000); // 30 s to the end of the round
    expect(s.pulseStart).toBe(82);
    expect(s.pulsePeak).toBe(97);
    expect(s.pulsePeakT).toBe(31_000);
    expect(s.breathingMean).toBe(16);
    expect(s.maxStep).toBe(4);
  });

  it('summarises a caught round with no vitals', () => {
    let g = startGame(createGame(), T0);
    for (let i = 1; i <= CAUGHT_STEP; i++) g = onBlink(g, T0 + i * 2_000);
    const s = summarize(g, []);
    expect(s.outcome).toBe('caught');
    expect(s.durationMs).toBe(CAUGHT_STEP * 2_000);
    expect(s.pulseStart).toBeNull();
    expect(s.pulsePeak).toBeNull();
    expect(s.breathingMean).toBeNull();
    expect(s.longestStareMs).toBe(2_000);
  });
});

describe('helpers', () => {
  it('formats clocks', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(41_400)).toBe('0:41');
    expect(clock(60_000)).toBe('1:00');
  });

  it('thins long series and keeps the ends', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const t = thin(xs, 5);
    expect(t).toHaveLength(5);
    expect(t[0]).toBe(0);
    expect(t[4]).toBe(999);
    expect(thin([1, 2], 5)).toEqual([1, 2]);
  });
});
