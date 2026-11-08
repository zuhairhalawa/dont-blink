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
import { FaceWatch, faceWatchSupported } from 'kit/vitals/FaceWatch';
import { HeadWatch } from 'kit/vitals/HeadWatch';
import { PersonMask } from 'kit/vitals/PersonMask';
import type { VitalsReading } from 'kit/vitals/types';
import {
  createGame, startGame, onBlink, onFace, onEyes, tick, secondsLeft, stareProgress,
  CAUGHT_STEP, type GameState,
} from './game/rules';
import { drawFrame, poseFor, POSES } from './game/corridor';
import { drawRoom, faceToScreen, type ScreenFace } from './game/room';
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

/** Validation codes good enough to play: kOk, kChestNotVisible, kCameraTuning. */
const READY_CODES = new Set([0, 7, 10]);

let sensor: PresageSensor | null = null;
let latest: VitalsReading | null = null;
let faceWatch: { stop(): void } | null = null;
let headWatch: HeadWatch | null = null;
let personMask: PersonMask | null = null;
/** Hidden video of the camera stream: drawn as the room and used for the scare cam. */
let camVideo: HTMLVideoElement | null = null;

/** The player's face on screen (mirrored, normalised), if head tracking has one. */
function screenFace(w: number, h: number): ScreenFace | null {
  const box = headWatch?.faceBox;
  const v = camVideo;
  if (!box || !v || !v.videoWidth) return null;
  return faceToScreen(box, v.videoWidth, v.videoHeight, w, h);
}
/** Latest SDK validation code is good enough to play. */
let signalOk = false;
/** The player is facing the screen (HeadWatch, or FaceWatch as a fallback). */
let facing = true;
let faceOk = false;

/** Update the get-ready hint and the Begin button from both signals. */
function refreshReady(sdkMessage: string): void {
  // Head direction is learned again when the round starts, so it does not
  // gate the Begin button.
  faceOk = signalOk;
  const el = $('ready-hint');
  el.textContent = faceOk ? 'Signal good. You can begin.' : sdkMessage;
  el.dataset['ok'] = String(faceOk);
  $<HTMLButtonElement>('btn-begin').disabled = !faceOk;
}
let lastSdkMessage = 'Starting the camera…';

async function startCamera(): Promise<void> {
  const apiKey = await window.dontBlink.getPresageApiKey();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, frameRate: 30 },
  });
  const s = new PresageSensor(apiKey, stream, getConsentRecord()?.telemetry === true);
  sensor = s;

  s.on('hint', ({ code, message }) => {
    // Blinks only need the face. "Chest not visible" (7) and "camera
    // adjusting" (10) affect breathing, not blinks, so they don't block play.
    signalOk = READY_CODES.has(code);
    lastSdkMessage = message;
    refreshReady(message);
  });

  s.on('reading', (r) => {
    latest = r;
    if (r.pulseRate !== null) {
      $('ready-pulse').textContent = `Pulse ${Math.round(r.pulseRate)} bpm`;
    }
    if (round) round.onReading(r);
  });

  s.on('blink', () => {
    console.info('[blink]');
    round?.onBlink(Date.now());
  });

  s.on('fatalError', (message) => {
    sensor = null;
    round?.abort();
    $('error-text').textContent = message;
    $('error').hidden = false;
  });

  const preview = $<HTMLVideoElement>('preview');
  preview.srcObject = stream;
  void preview.play().catch(() => undefined);
  // Looking away: the SDK's status doesn't change when the player turns away,
  // so head direction comes from MediaPipe Face Landmarker (on this device).
  // If it can't load, fall back to Chromium's FaceDetector, which at least
  // notices leaving the frame.
  const onFacing = (present: boolean) => {
    console.info(`[face] ${present ? 'facing the screen' : 'looked away'}`);
    facing = present;
    refreshReady(lastSdkMessage);
    round?.onFace(present, Date.now());
  };
  try {
    const hw = await HeadWatch.create(stream, onFacing, (n) => window.dontBlink.loadAsset(n));
    hw.start();
    faceWatch = hw;
    headWatch = hw;
    // Long eye closures: Presage reports quick blinks, so held-shut eyes come
    // from MediaPipe's eye scores.
    hw.onEyes = (closed) => {
      console.info(`[eyes] ${closed ? 'closed' : 'open'}`);
      round?.onEyes(closed, Date.now());
    };
    console.info('[app] head tracking on (MediaPipe)');
  } catch (err) {
    console.warn('[app] head tracking unavailable, using face presence only:', err);
    if (faceWatchSupported()) {
      const fw = new FaceWatch(stream, onFacing);
      fw.start();
      faceWatch = fw;
    }
  }
  // The room: the camera picture is drawn as the play screen, with the
  // player cut out by a person mask so the Watcher can stand behind them.
  camVideo = document.createElement('video');
  camVideo.muted = true;
  camVideo.playsInline = true;
  camVideo.srcObject = stream;
  void camVideo.play().catch(() => undefined);
  try {
    personMask = await PersonMask.create(camVideo, (n) => window.dontBlink.loadAsset(n));
    personMask.start();
    console.info('[app] person mask on (MediaPipe)');
  } catch (err) {
    console.warn('[app] person mask unavailable; the Watcher will be drawn over you:', err);
  }
  await s.start();
}

async function stopCamera(): Promise<void> {
  const s = sensor;
  sensor = null;
  latest = null;
  faceOk = false;
  signalOk = false;
  facing = true;
  faceWatch?.stop();
  faceWatch = null;
  headWatch = null;
  personMask?.stop();
  personMask = null;
  if (camVideo) camVideo.srcObject = null;
  camVideo = null;
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
  private moves = 0;
  private closestShown = 0;
  private lungeFrom = 0;
  private nextBlackoutAt = Infinity;
  private photo: HTMLCanvasElement | null = null;

  start(): void {
    show('play');
    this.resize();
    window.addEventListener('resize', this.resize);
    this.audio.start();
    this.introStart = performance.now();
    // Learn the resting head position during the intro, while the player looks at the screen.
    headWatch?.recalibrate();
    $('hud-message').textContent = 'It is somewhere in your room. Keep your eyes open.';
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

  onEyes(closed: boolean, now: number): void {
    const before = this.game;
    this.game = onEyes(this.game, closed, now);
    if (this.game.step !== before.step) this.closeLids(performance.now());
  }

  onFace(present: boolean, now: number): void {
    const before = this.game;
    this.game = onFace(this.game, present, now);
    if (!present && this.game.phase === 'playing') $('hud-message').textContent = 'Look at the screen.';
    if (present && before.away) $('hud-message').textContent = '';
    if (this.game.step !== before.step) {
      // You looked away: it moved while you were not watching.
      this.showStep(this.game.step, performance.now());
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
      this.nextBlackoutAt = t + 7000;
    }

    const before = this.game;
    this.game = tick(this.game, now);
    if (this.game.step > before.step && this.game.eyesShut) {
      // Eyes held shut: you hear it take another step.
      this.closeLids(t);
    }
    if (this.game.step < before.step) {
      // Held stare: the bulb dips and it is further away when the light returns.
      this.bulbDipUntil = t + 220;
      this.audio.retreated();
    }

    // Fake-outs: once it is part-way down the corridor, the bulb sometimes
    // dies for a moment. Nothing moves; the dark does the work.
    const dread = this.shownStep / CAUGHT_STEP;
    if (this.game.phase === 'playing' && dread >= 0.25 && t >= this.nextBlackoutAt) {
      this.bulbDipUntil = t + 300 + Math.random() * 450;
      this.nextBlackoutAt = t + 5000 + Math.random() * 6000;
    }

    // Eyelid animation: quick close, then open.
    if (t < this.lidsUntil) {
      this.lids = Math.min(1, this.lids + 0.45);
    } else {
      this.lids = Math.max(0, this.lids - 0.12);
    }
    if ((this.lids >= 0.95 || t < this.bulbDipUntil) && this.shownStep !== this.game.step) this.showStep(this.game.step, t);

    this.audio.setDread(this.shownStep / CAUGHT_STEP);
    this.audio.setPulse(latest?.pulseRate ?? null);

    // End of round.
    if (this.game.phase === 'caught' && this.caughtAt === null) {
      this.caughtAt = t;
      this.lungeFrom = this.shownStep;
      this.lids = 0;
      this.lidsUntil = 0;
      this.audio.shriek();
      this.endAt = t + 2800;
      // Scare cam: your face a quarter-second into the scare.
      setTimeout(() => this.snap(), 250);
    }
    if (this.game.phase === 'survived' && this.endAt === null) {
      this.audio.release();
      $('hud-message').textContent = 'It lets you go.';
      this.endAt = t + 2200;
    }

    const sinceCaught = this.caughtAt === null ? null : t - this.caughtAt;
    let step = this.shownStep;
    let mouth = 0;
    if (sinceCaught !== null) {
      // The lunge: a fast rush from wherever it stood, mouth tearing open.
      const k = Math.min(1, sinceCaught / 200);
      step = this.lungeFrom + (CAUGHT_STEP - this.lungeFrom) * k * k;
      mouth = Math.min(1, sinceCaught / 320);
    }
    const w = this.canvas.width;
    const h = this.canvas.height;
    const effects = {
      time: t,
      step,
      lids: this.lids,
      shake: sinceCaught !== null && sinceCaught < 800 ? 46 : 0,
      redWash: sinceCaught !== null && sinceCaught > 90 ? Math.max(0, 1 - sinceCaught / 1600) : 0,
      flash: sinceCaught !== null && sinceCaught < 70 ? 0.85 : 0,
      pose: sinceCaught !== null ? POSES[0]! : poseFor(this.moves),
      mouth,
    };
    const light = t < this.bulbDipUntil ? 0.06 : this.game.phase === 'survived' ? 0.6 : 1;
    if (camVideo && camVideo.readyState >= 2) {
      // It's in your room.
      drawRoom(this.ctx, { ...effects, w, h, video: camVideo, mask: personMask?.hasMask ? personMask.canvas : null,
        face: screenFace(w, h), bright: light });
    } else {
      // No camera picture yet: fall back to the corridor.
      drawFrame(this.ctx, { ...effects, w, h, bulb: light });
    }
    this.updateHud(t, now);

    if (this.endAt !== null && t >= this.endAt) {
      this.finish(true);
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Move the drawn Watcher to `step`, in a new pose; photograph a new closest moment. */
  private showStep(step: number, t: number): void {
    this.shownStep = step;
    this.moves += 1;
    if (step > this.closestShown) {
      this.closestShown = step;
      if (this.game.phase === 'playing') setTimeout(() => this.snap(), 300);
    }
    void t;
  }

  /**
   * Scare cam: one still of the player's room with the Watcher right behind
   * their shoulder, kept in memory for the end card (saved only if they
   * choose Save image).
   */
  private snap(): void {
    const v = camVideo;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = Math.round((960 * v.videoHeight) / v.videoWidth);
    drawRoom(c.getContext('2d')!, {
      w: c.width, h: c.height, time: performance.now(), video: v,
      mask: personMask?.hasMask ? personMask.canvas : null, face: screenFace(c.width, c.height),
      step: CAUGHT_STEP - 1, lids: 0, bright: 1.15, shake: 0, redWash: 0, flash: 0, pose: poseFor(this.moves), mouth: 0,
    });
    this.photo = c;
  }

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
    drawEndCard($<HTMLCanvasElement>('card'), summary, this.samples, this.photo);
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
