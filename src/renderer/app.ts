/**
 * src/renderer/app.ts
 *
 * Screen flow: consent -> get ready -> play -> end card.
 *
 * The camera turns on only after "Turn on the camera", and stays on between
 * rounds so "Play again" is instant. "Turn off the camera" (or closing the
 * window) stops the SDK and releases the webcam.
 *
 * Game time uses Date.now() at the moment each SDK event arrives. The probe
 * measured blink events arriving within a few ms of their SDK timestamps.
 */

import { setConsent, getConsentRecord } from 'kit/consent/ConsentRecord';
import { PresageSensor } from 'kit/vitals/PresageSensor';
import type { VitalsReading } from 'kit/vitals/types';
import {
  createGame, startGame, onBlink, onFace, tick, secondsLeft, stareProgress,
  CAUGHT_STEP, type GameState,
} from './game/rules';
import { drawFrame } from './game/corridor';
import { GameAudio } from './game/sound';
import { summarize, type Sample } from './game/summary';
import { drawEndCard } from './game/endCard';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type ScreenId = 'consent' | 'ready' | 'play' | 'end';

function show(id: ScreenId): void {
  for (const s of ['consent', 'ready', 'play', 'end'] as const) {
    $(`screen-${s}`).hidden = s !== id;
  }
}

// ---------------------------------------------------------------------------
// Sensor state (lives across rounds)
// ---------------------------------------------------------------------------

let sensor: PresageSensor | null = null;
let latest: VitalsReading | null = null;
let faceOk = false;

async function startCamera(): Promise<void> {
  const apiKey = await window.dontBlink.getPresageApiKey();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, frameRate: 30 },
  });
  const s = new PresageSensor(apiKey, stream, getConsentRecord()?.telemetry === true);
  sensor = s;

  s.on('hint', ({ code, message }) => {
    faceOk = code === 0;
    const el = $('ready-hint');
    el.textContent = code === 0 ? 'Signal good. You can begin.' : message;
    el.dataset['ok'] = String(code === 0);
    $<HTMLButtonElement>('btn-begin').disabled = !faceOk;
  });

  s.on('reading', (r) => {
    latest = r;
    if (r.pulseRate !== null) {
      $('ready-pulse').textContent = `Pulse ${Math.round(r.pulseRate)} bpm`;
    }
    if (round) round.onReading(r);
  });

  s.on('blink', () => round?.onBlink(Date.now()));
  s.on('face', (present) => round?.onFace(present, Date.now()));

  s.on('fatalError', (message) => {
    sensor = null;
    round?.abort();
    $('error-text').textContent = message;
    $('error').hidden = false;
  });

  const preview = $<HTMLVideoElement>('preview');
  preview.srcObject = stream;
  void preview.play().catch(() => undefined);
  await s.start();
}

async function stopCamera(): Promise<void> {
  const s = sensor;
  sensor = null;
  latest = null;
  faceOk = false;
  $<HTMLVideoElement>('preview').srcObject = null;
  $<HTMLButtonElement>('btn-begin').disabled = true;
  if (s) await s.stop();
}

// ---------------------------------------------------------------------------
// One round
// ---------------------------------------------------------------------------

class Round {
  private game: GameState = createGame();
  private readonly samples: Sample[] = [];
  private readonly audio = new GameAudio();
  private readonly canvas = $<HTMLCanvasElement>('corridor');
  private readonly ctx = this.canvas.getContext('2d')!;
  private raf = 0;
  private introStart = 0;
  /** Step drawn on screen; it changes only while the eyes are closed or the bulb is dark. */
  private shownStep = 0;
  private lids = 0;
  private lidsUntil = 0;
  private bulbDipUntil = 0;
  private endAt: number | null = null;
  private caughtAt: number | null = null;
  private lastBeat = 0;
  private done = false;

  start(): void {
    show('play');
    this.resize();
    window.addEventListener('resize', this.resize);
    this.audio.start();
    this.introStart = performance.now();
    $('hud-message').textContent = 'Keep your eyes open.';
    $('hud-tally').textContent = '';
    $('hud-time').textContent = '60';
    this.raf = requestAnimationFrame(this.frame);
  }

  onReading(r: VitalsReading): void {
    if (this.game.phase !== 'playing') return;
    this.samples.push({ t: Date.now() - this.game.startMs, pulse: r.pulseRate, breathing: r.breathingRate });
  }

  onBlink(now: number): void {
    const before = this.game;
    this.game = onBlink(this.game, now);
    if (this.game !== before) this.closeLids(performance.now());
  }

  onFace(present: boolean, now: number): void {
    const before = this.game;
    this.game = onFace(this.game, present, now);
    if (!present && this.game.phase === 'playing') $('hud-message').textContent = 'Look at the screen.';
    if (present && before.away) $('hud-message').textContent = '';
    if (this.game.step !== before.step) {
      // You looked away: it moved while you were not watching.
      this.shownStep = this.game.step;
      this.audio.moved();
    }
  }

  /** Stop without an end card (fatal error or camera off). */
  abort(): void {
    this.finish(false);
  }

  private closeLids(t: number): void {
    // Lids snap shut for ~130 ms; the Watcher moves while they are closed.
    this.lidsUntil = t + 130;
    this.audio.moved();
  }

  private readonly resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
  };

  private readonly frame = (t: number): void => {
    if (this.done) return;
    const now = Date.now();

    // Intro: three seconds of corridor before the clock starts.
    if (this.game.phase === 'ready' && t - this.introStart > 3000) {
      this.game = startGame(this.game, now);
      $('hud-message').textContent = '';
    }

    const before = this.game;
    this.game = tick(this.game, now);
    if (this.game.step < before.step) {
      // Held stare: the bulb dips and it is further away when the light returns.
      this.bulbDipUntil = t + 220;
      this.audio.retreated();
    }

    // Eyelid animation: quick close, then open.
    if (t < this.lidsUntil) {
      this.lids = Math.min(1, this.lids + 0.45);
    } else {
      this.lids = Math.max(0, this.lids - 0.12);
    }
    if (this.lids >= 0.95 || t < this.bulbDipUntil) this.shownStep = this.game.step;

    this.audio.setDread(this.shownStep / CAUGHT_STEP);
    this.audio.setPulse(latest?.pulseRate ?? null);

    // End of round.
    if (this.game.phase === 'caught' && this.caughtAt === null) {
      this.caughtAt = t;
      this.shownStep = CAUGHT_STEP;
      this.lids = 0;
      this.lidsUntil = 0;
      this.audio.shriek();
      this.endAt = t + 2600;
    }
    if (this.game.phase === 'survived' && this.endAt === null) {
      this.audio.release();
      $('hud-message').textContent = 'It lets you go.';
      this.endAt = t + 2200;
    }

    const sinceCaught = this.caughtAt === null ? null : t - this.caughtAt;
    drawFrame(this.ctx, {
      w: this.canvas.width,
      h: this.canvas.height,
      time: t,
      step: this.shownStep,
      lids: this.lids,
      bulb: t < this.bulbDipUntil ? 0.08 : this.game.phase === 'survived' ? 0.6 : 1,
      shake: sinceCaught !== null && sinceCaught < 700 ? 40 : 0,
      redWash: sinceCaught !== null ? Math.max(0, 1 - sinceCaught / 1500) : 0,
    });
    this.updateHud(t, now);

    if (this.endAt !== null && t >= this.endAt) {
      this.finish(true);
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private updateHud(t: number, now: number): void {
    $('hud-time').textContent = String(secondsLeft(this.game, now));
    $('hud-bpm').textContent = latest?.pulseRate != null ? String(Math.round(latest.pulseRate)) : '–';
    $('hud-tally').textContent = '|'.repeat(this.game.blinks);
    $('hud-stare').style.width = `${Math.round(stareProgress(this.game, now) * 100)}%`;
    // Beat the dot at the live pulse rate.
    const bpm = latest?.pulseRate;
    if (bpm && t - this.lastBeat > 60_000 / bpm) {
      this.lastBeat = t;
      const dot = $('hud-beat');
      dot.classList.add('on');
      setTimeout(() => dot.classList.remove('on'), 90);
    }
  }

  private finish(showCard: boolean): void {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    void this.audio.close();
    round = null;
    if (!showCard) {
      show('consent');
      return;
    }
    const summary = summarize(this.game, this.samples);
    drawEndCard($<HTMLCanvasElement>('card'), summary, this.samples);
    $('save-status').textContent = '';
    show('end');
    $('btn-again').focus();
  }
}

let round: Round | null = null;

function beginRound(): void {
  if (!sensor || round) return;
  round = new Round();
  round.start();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  show('consent');

  $('btn-agree').addEventListener('click', async () => {
    setConsent($<HTMLInputElement>('telemetry').checked);
    show('ready');
    $('ready-hint').textContent = 'Starting the camera…';
    try {
      await startCamera();
      $('ready-hint').textContent = 'Look at the screen.';
    } catch (err) {
      await stopCamera();
      $('error-text').textContent =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow the camera for this app and try again.'
          : `The camera could not start: ${err instanceof Error ? err.message : String(err)}`;
      $('error').hidden = false;
    }
  });

  $('btn-begin').addEventListener('click', beginRound);
  $('btn-again').addEventListener('click', () => {
    show('ready');
    $<HTMLButtonElement>('btn-begin').disabled = !faceOk;
  });

  const cameraOff = async () => {
    round?.abort();
    await stopCamera();
    show('consent');
  };
  $('btn-camera-off').addEventListener('click', () => void cameraOff());
  $('btn-end-camera-off').addEventListener('click', () => void cameraOff());

  $('btn-save').addEventListener('click', async () => {
    const res = await window.dontBlink.savePng($<HTMLCanvasElement>('card').toDataURL('image/png'));
    $('save-status').textContent = res.ok ? `Saved to ${res.path}` : res.error ? `Not saved: ${res.error}` : '';
  });

  $('btn-error-close').addEventListener('click', () => {
    $('error').hidden = true;
    void stopCamera();
    show('consent');
  });

  // Keyboard: Space begins when ready; Escape quits a round to the start.
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !$('screen-ready').hidden && !$<HTMLButtonElement>('btn-begin').disabled) {
      e.preventDefault();
      beginRound();
    }
    if (e.key === 'Escape' && round) {
      round.abort();
      show('ready');
    }
  });

  window.addEventListener('beforeunload', () => void stopCamera());
});
