import { describe, it, expect } from 'vitest';
import {
  createGame, startGame, onBlink, onFace, tick, secondsLeft, stareProgress,
  ROUND_MS, CAUGHT_STEP, STARE_RETREAT_MS, BLINK_DEBOUNCE_MS, LOOK_AWAY_STEPS,
} from '../../src/renderer/game/rules';

const T0 = 1_000_000;

describe('rules', () => {
  it('ignores blinks before the round starts', () => {
    const s = onBlink(createGame(), T0);
    expect(s.step).toBe(0);
    expect(s.blinks).toBe(0);
  });

  it('moves the Watcher one step per blink', () => {
    let s = startGame(createGame(), T0);
    s = onBlink(s, T0 + 1000);
    s = onBlink(s, T0 + 2000);
    expect(s.step).toBe(2);
    expect(s.blinks).toBe(2);
    expect(s.events.filter((e) => e.kind === 'blink').map((e) => e.t)).toEqual([1000, 2000]);
  });

  it('counts blink onsets inside the debounce window once', () => {
    let s = startGame(createGame(), T0);
    s = onBlink(s, T0 + 1000);
    s = onBlink(s, T0 + 1000 + BLINK_DEBOUNCE_MS - 1);
    expect(s.step).toBe(1);
    s = onBlink(s, T0 + 1000 + BLINK_DEBOUNCE_MS);
    expect(s.step).toBe(2);
  });

  it('looking away costs LOOK_AWAY_STEPS once, and blinks while away do not count', () => {
    let s = startGame(createGame(), T0);
    s = onFace(s, false, T0 + 500);
    s = onFace(s, false, T0 + 600);
    s = onBlink(s, T0 + 700);
    expect(s.step).toBe(LOOK_AWAY_STEPS);
    expect(s.lookAways).toBe(1);
    expect(s.blinks).toBe(0);
    s = onFace(s, true, T0 + 900);
    expect(s.away).toBe(false);
  });

  it('is caught at CAUGHT_STEP and ignores later input', () => {
    let s = startGame(createGame(), T0);
    for (let i = 1; i <= CAUGHT_STEP; i++) s = onBlink(s, T0 + i * 1000);
    expect(s.phase).toBe('caught');
    expect(s.step).toBe(CAUGHT_STEP);
    expect(s.events.at(-1)?.kind).toBe('caught');
    const after = onBlink(s, T0 + 20_000);
    expect(after).toBe(s);
  });

  it('never goes past CAUGHT_STEP when looking away near the end', () => {
    let s = startGame(createGame(), T0);
    for (let i = 1; i < CAUGHT_STEP; i++) s = onBlink(s, T0 + i * 1000);
    s = onFace(s, false, T0 + 9000);
    expect(s.step).toBe(CAUGHT_STEP);
    expect(s.phase).toBe('caught');
  });

  it('backs off one step after a long stare, and the stare timer restarts', () => {
    let s = startGame(createGame(), T0);
    s = onBlink(s, T0 + 1000);
    s = onBlink(s, T0 + 2000);
    s = tick(s, T0 + 2000 + STARE_RETREAT_MS - 1);
    expect(s.step).toBe(2);
    s = tick(s, T0 + 2000 + STARE_RETREAT_MS);
    expect(s.step).toBe(1);
    s = tick(s, T0 + 2000 + STARE_RETREAT_MS + 10);
    expect(s.step).toBe(1);
    expect(s.maxStep).toBe(2);
  });

  it('does not back off below step 0 or while looking away', () => {
    let s = startGame(createGame(), T0);
    s = tick(s, T0 + STARE_RETREAT_MS * 2);
    expect(s.step).toBe(0);
    s = onFace(s, false, T0 + 17_000);
    s = tick(s, T0 + 17_000 + STARE_RETREAT_MS * 2);
    expect(s.step).toBe(LOOK_AWAY_STEPS);
  });

  it('is survived at ROUND_MS', () => {
    let s = startGame(createGame(), T0);
    s = tick(s, T0 + ROUND_MS);
    expect(s.phase).toBe('survived');
    expect(s.events.at(-1)).toEqual({ t: ROUND_MS, kind: 'survived', step: 0 });
  });

  it('reports seconds left and stare progress', () => {
    const ready = createGame();
    expect(secondsLeft(ready, T0)).toBe(ROUND_MS / 1000);
    let s = startGame(ready, T0);
    expect(secondsLeft(s, T0 + 500)).toBe(ROUND_MS / 1000);
    expect(stareProgress(s, T0 + 1000)).toBe(0);
    s = onBlink(s, T0 + 1000);
    expect(stareProgress(s, T0 + 1000 + STARE_RETREAT_MS / 2)).toBeCloseTo(0.5);
    expect(secondsLeft(tick(s, T0 + ROUND_MS), T0 + ROUND_MS)).toBe(0);
  });
});
