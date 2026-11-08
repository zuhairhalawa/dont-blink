/**
 * src/renderer/game/rules.ts
 *
 * The rules of Don't Blink, as pure functions with no DOM, timers or audio,
 * so they can be unit-tested and replayed.
 *
 *   - The Watcher stands at the far end of the corridor (step 0).
 *   - Every blink lets it move one step closer.
 *   - Looking away from the screen lets it move two steps closer.
 *   - Keep your eyes shut and it keeps coming: one step every EYES_SHUT_STEP_MS.
 *   - Keep your eyes open for STARE_RETREAT_MS and it backs off one step.
 *   - It reaches you at CAUGHT_STEP: you lose.
 *   - Survive ROUND_MS: you win.
 *
 * All times are milliseconds on one clock (the caller uses Date.now()).
 */

export const ROUND_MS = 60_000;
export const CAUGHT_STEP = 8;
export const STARE_RETREAT_MS = 8_000;
/** Blink onsets closer together than this count once (one blink, not two). */
export const BLINK_DEBOUNCE_MS = 350;
/** Steps the Watcher moves when you look away. */
export const LOOK_AWAY_STEPS = 2;
/** While the eyes stay shut, it takes another step this often. */
export const EYES_SHUT_STEP_MS = 1500;

export type Phase = 'ready' | 'playing' | 'caught' | 'survived';

export type GameEventKind = 'blink' | 'eyesShut' | 'lookAway' | 'advance' | 'retreat' | 'caught' | 'survived';

export interface GameEvent {
  /** Milliseconds since the round started. */
  t: number;
  kind: GameEventKind;
  /** Watcher step after the event. */
  step: number;
}

export interface GameState {
  phase: Phase;
  startMs: number;
  /** 0 = far end of the corridor, CAUGHT_STEP = at your face. */
  step: number;
  /** Highest step reached this round. */
  maxStep: number;
  blinks: number;
  lookAways: number;
  /** When the eyes were last "lost" (blink or look away); stare timer origin. */
  lastLossMs: number;
  lastBlinkMs: number;
  /** True while the face is away from the screen. */
  away: boolean;
  /** True while the eyes are held shut. */
  eyesShut: boolean;
  events: GameEvent[];
}

export function createGame(): GameState {
  return {
    phase: 'ready',
    startMs: 0,
    step: 0,
    maxStep: 0,
    blinks: 0,
    lookAways: 0,
    lastLossMs: 0,
    lastBlinkMs: -Infinity,
    away: false,
    eyesShut: false,
    events: [],
  };
}

export function startGame(s: GameState, now: number): GameState {
  return { ...createGame(), phase: 'playing', startMs: now, lastLossMs: now };
}

function moveCloser(s: GameState, now: number, steps: number, cause: 'blink' | 'eyesShut' | 'lookAway'): GameState {
  const t = now - s.startMs;
  const step = Math.min(CAUGHT_STEP, s.step + steps);
  const events: GameEvent[] = [...s.events, { t, kind: cause, step }, { t, kind: 'advance', step }];
  const next: GameState = {
    ...s,
    step,
    maxStep: Math.max(s.maxStep, step),
    lastLossMs: now,
    events,
  };
  if (step >= CAUGHT_STEP) {
    next.phase = 'caught';
    next.events = [...events, { t, kind: 'caught', step }];
  }
  return next;
}

/** A blink was detected at `at`. */
export function onBlink(s: GameState, at: number): GameState {
  if (s.phase !== 'playing' || s.away) return s;
  if (at - s.lastBlinkMs < BLINK_DEBOUNCE_MS) return s;
  const moved = moveCloser(s, at, 1, 'blink');
  return { ...moved, blinks: s.blinks + 1, lastBlinkMs: at };
}

/** The face left (present=false) or came back (present=true). */
export function onFace(s: GameState, present: boolean, now: number): GameState {
  if (s.phase !== 'playing') return s;
  if (!present && !s.away) {
    const moved = moveCloser(s, now, LOOK_AWAY_STEPS, 'lookAway');
    return { ...moved, away: true, lookAways: s.lookAways + 1 };
  }
  if (present && s.away) {
    // The stare timer restarts once you look back.
    return { ...s, away: false, lastLossMs: now };
  }
  return s;
}

/**
 * The eyes closed (closed=true) or opened again. Closing counts as a blink;
 * while they stay shut, tick() keeps the Watcher coming.
 */
export function onEyes(s: GameState, closed: boolean, now: number): GameState {
  if (s.phase !== 'playing') return s;
  if (closed && !s.eyesShut) return { ...onBlink(s, now), eyesShut: true };
  if (!closed && s.eyesShut) return { ...s, eyesShut: false };
  return s;
}

/** Advance time: handle shut eyes, the stare retreat and the end of the round. */
export function tick(s: GameState, now: number): GameState {
  if (s.phase !== 'playing') return s;
  const t = now - s.startMs;
  if (t >= ROUND_MS) {
    return { ...s, phase: 'survived', events: [...s.events, { t: ROUND_MS, kind: 'survived', step: s.step }] };
  }
  if (s.eyesShut && now - s.lastLossMs >= EYES_SHUT_STEP_MS) {
    return moveCloser(s, now, 1, 'eyesShut');
  }
  if (!s.away && !s.eyesShut && s.step > 0 && now - s.lastLossMs >= STARE_RETREAT_MS) {
    const step = s.step - 1;
    return { ...s, step, lastLossMs: now, events: [...s.events, { t, kind: 'retreat', step }] };
  }
  return s;
}

/** Seconds left in the round, rounded up, never negative. */
export function secondsLeft(s: GameState, now: number): number {
  if (s.phase === 'ready') return Math.ceil(ROUND_MS / 1000);
  if (s.phase !== 'playing') return 0;
  return Math.max(0, Math.ceil((ROUND_MS - (now - s.startMs)) / 1000));
}

/** Progress (0-1) of the current stare toward the next retreat. */
export function stareProgress(s: GameState, now: number): number {
  if (s.phase !== 'playing' || s.away || s.step === 0) return 0;
  return Math.min(1, (now - s.lastLossMs) / STARE_RETREAT_MS);
}
