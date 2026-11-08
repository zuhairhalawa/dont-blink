/**
 * apps/scare-meter/renderer/app.ts
 *
 * View router and application lifecycle for the Scare Meter renderer.
 *
 * Flow (design §7):
 *   ConsentScreen → CalibrationView → SceneView (Phase 11) → ReportView (Phase 12)
 *
 * This module implements Phase 10 (T-29 – T-33):
 *   T-31  View router, consent handling, calibration kick-off
 *   T-32  CalibrationView — warm-up, countdown, LiveReadout, baseline computation
 *   T-33  Stop button — visible on every non-consent screen
 *
 * Calibration now has two phases:
 *   1. Warm-up  — "Warming up…" message; waits until both a pulse and a
 *                 breathing rate have arrived (or 90 s timeout → retry).
 *   2. Baseline — 20 s countdown collects readings for computeBaseline().
 *
 * Each view is a <section> in index.html.  show/hide swap the `hidden`
 * attribute so only one section is visible at a time.
 */

import { mountConsentScreen } from 'kit/consent/ConsentScreen';
import { mountLiveReadout, type LiveReadoutHandle } from 'kit/ui/LiveReadout';
import { computeBaseline } from 'kit/signal';
import type { VitalsReading, Baseline } from 'kit/vitals';
import { RendererVitalsSource } from 'kit/vitals';
import { initVitals } from './vitals';

// ---------------------------------------------------------------------------
// DOM references — all queried once on DOMContentLoaded
// ---------------------------------------------------------------------------

let consentSection: HTMLElement;
let calibrationSection: HTMLElement;
let sceneSection: HTMLElement;
let reportSection: HTMLElement;
let stopBtn: HTMLButtonElement;
let demoBadge: HTMLElement;
let errorModal: HTMLElement;
let errorMessage: HTMLElement;
let errorCloseBtn: HTMLButtonElement;

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

/** The active vitals source — set during calibration, used through scene. */
let activeSource: RendererVitalsSource | null = null;

/** Baseline computed after 20 s of calibration. */
let calibrationBaseline: Baseline | null = null;

// ---------------------------------------------------------------------------
// Calibration timing constants
// ---------------------------------------------------------------------------

/** Duration of the baseline measurement window (ms). */
const BASELINE_DURATION_MS = 20_000;

/**
 * Maximum time to wait during warm-up before giving up (ms).
 * The first valid pulse typically arrives ~20-25 s after the face is steady;
 * breathing is usually faster (~13 s). 90 s covers sluggish SDK start-up.
 */
const WARMUP_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function showView(id: string): void {
  for (const section of document.querySelectorAll<HTMLElement>('.view')) {
    section.hidden = section.id !== id;
  }
  // Stop button is visible everywhere except the consent screen.
  stopBtn.hidden = id === 'view-consent';
}

// ---------------------------------------------------------------------------
// Stop button (T-33)
// ---------------------------------------------------------------------------

function onStop(): void {
  if (activeSource) {
    activeSource.stop().catch((e: unknown) => {
      console.warn('Error stopping vitals source:', e);
    });
    activeSource = null;
  }
  // Navigate to the report view with whatever data was collected so far.
  // Phase 12 will render a proper report; for now the shell HTML shows a stub.
  showView('view-report');
  stopBtn.hidden = true;
}

// ---------------------------------------------------------------------------
// Fatal-error modal
// ---------------------------------------------------------------------------

function showFatalError(message: string): void {
  errorMessage.textContent = message;
  errorModal.hidden = false;
  if (activeSource) {
    activeSource.stop().catch(() => undefined);
    activeSource = null;
  }
}

// ---------------------------------------------------------------------------
// CalibrationView (T-32)
// ---------------------------------------------------------------------------

/**
 * Mount the calibration view, start the vitals source, run through a warm-up
 * phase (waiting for both pulse and breathing to arrive), then collect a 20 s
 * baseline, compute the baseline, and dispatch 'calibration:done'.
 *
 * Two-phase calibration flow:
 *   Phase A — Warm-up: camera starts, we wait for the first valid pulse AND
 *             the first breathing rate.  A 90 s timeout fires the retry path
 *             with the most recent hint.
 *   Phase B — Baseline: 20 s countdown.  Each reading is collected for
 *             computeBaseline().  If the result is null-null a retry is offered.
 */
async function startCalibration(): Promise<void> {
  showView('view-calibration');

  // Mount the live readout into its placeholder.
  const readoutContainer = document.getElementById('calibration-readout')!;
  const readoutHandle: LiveReadoutHandle = mountLiveReadout(readoutContainer);

  const countdownEl   = document.getElementById('calibration-countdown')!;
  const statusEl      = document.getElementById('calibration-status-text')!;
  const hintEl        = document.getElementById('calibration-hint') as HTMLElement;
  const retryBtn      = document.getElementById('calibration-retry-btn') as HTMLButtonElement;
  const previewVideo  = document.getElementById('calibration-preview') as HTMLVideoElement;

  // ---- Reset UI to warm-up state ----
  countdownEl.textContent = '';
  statusEl.textContent    = 'Warming up — this can take up to a minute.';
  hintEl.hidden           = true;
  hintEl.textContent      = '';
  retryBtn.hidden         = true;

  // Initialise the vitals source (camera permission prompt or demo video).
  let source: RendererVitalsSource;
  try {
    source = await initVitals();
  } catch (e) {
    readoutHandle.destroy();
    showFatalError(
      e instanceof Error
        ? e.message
        : 'Could not initialise the camera. Check permissions and try again.',
    );
    return;
  }

  activeSource = source;

  // --- Show camera preview ---
  // source.stream exposes the MediaStream that feeds the SDK (same stream
  // that getUserMedia returned), so we can attach it to the preview video
  // without opening a second camera.
  if (previewVideo) {
    previewVideo.srcObject = source.stream;
    previewVideo.play().catch(() => {
      // Autoplay may be blocked in some contexts; the preview is cosmetic.
    });
  }

  // Collected readings for baseline computation.
  const readings: VitalsReading[] = [];

  // Track whether we have received at least one non-null value for each metric.
  let hasPulse    = false;
  let hasBreath   = false;

  // Latest hint text for the retry message.
  let latestHint = '';

  // Forward hints from the SDK to the live readout and the hint label.
  source.on('hint', (h: { code: string; message: string }) => {
    latestHint = h.message;
    const isOk = h.code === '0';

    readoutHandle.setHint(isOk ? null : h.message);

    // On calibration screen: show hint in colour-coded span.
    hintEl.textContent = h.message;
    hintEl.hidden      = false;
    // Green for kOk, amber for everything else.
    hintEl.dataset['ok'] = isOk ? 'true' : 'false';
  });

  // Forward readings to the live readout and accumulate for the baseline.
  source.on('reading', (r: VitalsReading) => {
    readoutHandle.update(r);

    // Track warm-up completion.
    if (r.pulseRate !== null)    { hasPulse  = true; }
    if (r.breathingRate !== null) { hasBreath = true; }

    // Only accumulate during the baseline phase (readings is populated only
    // after checkWarmupDone() clears the warm-up timeout and enters phase B).
    if (inBaseline) {
      readings.push(r);
    }
  });

  // Handle fatal SDK errors.
  source.on('fatalError', (msg: string) => {
    readoutHandle.destroy();
    clearTimeout(warmupTimeout);
    if (tickInterval !== null) clearInterval(tickInterval);
    showFatalError(msg);
  });

  // Start capture.
  await source.start();

  // ------------------------------------------------------------------
  // Phase A: Warm-up — wait for first pulse + breathing reading
  // ------------------------------------------------------------------

  let inBaseline    = false;
  let tickInterval: ReturnType<typeof setInterval> | null = null;

  const warmupTimeout = setTimeout(() => {
    // 90 s passed without getting both metrics.
    showRetry(
      latestHint ||
        'Could not detect a signal. Make sure your face is visible and well-lit.',
    );
  }, WARMUP_TIMEOUT_MS);

  // Poll at 500 ms; the SDK runs at ~30 fps so this is more than fast enough.
  const warmupPoll = setInterval(() => {
    if (hasPulse && hasBreath) {
      clearInterval(warmupPoll);
      clearTimeout(warmupTimeout);
      enterBaseline();
    }
  }, 500);

  // ------------------------------------------------------------------
  // Phase B: Baseline countdown
  // ------------------------------------------------------------------

  function enterBaseline(): void {
    inBaseline = true;
    statusEl.textContent = 'Measuring your resting rate.';

    let remaining = Math.ceil(BASELINE_DURATION_MS / 1000);
    countdownEl.textContent = String(remaining);

    tickInterval = setInterval(() => {
      remaining -= 1;
      countdownEl.textContent = String(remaining > 0 ? remaining : 0);

      if (remaining <= 0) {
        clearInterval(tickInterval!);
        tickInterval = null;
        finishCalibration();
      }
    }, 1_000);
  }

  // -------------------------------------------------------------------------
  // Inner helpers scoped to this calibration run
  // -------------------------------------------------------------------------

  function finishCalibration(): void {
    const baseline = computeBaseline(readings, BASELINE_DURATION_MS);

    if (baseline.pulseRate === null && baseline.breathingRate === null) {
      showRetry(
        'Not enough readings. Make sure your face is clearly visible and try again.',
      );
      return;
    }

    calibrationBaseline = baseline;
    readoutHandle.destroy();

    // Stop the preview.
    if (previewVideo) {
      previewVideo.srcObject = null;
    }

    // Calibration succeeded — notify the router.
    calibrationSection.dispatchEvent(
      new CustomEvent('calibration:done', { bubbles: true }),
    );
  }

  function showRetry(message: string): void {
    inBaseline = false;
    if (tickInterval !== null) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    countdownEl.textContent  = '';
    statusEl.textContent     = '';
    hintEl.textContent       = message;
    hintEl.hidden            = false;
    hintEl.dataset['ok']     = 'false';
    retryBtn.hidden          = false;

    retryBtn.addEventListener('click', () => {
      retryBtn.hidden = true;
      hintEl.hidden   = true;
      readoutHandle.destroy();
      // Stop the preview before restarting.
      if (previewVideo) {
        previewVideo.srcObject = null;
      }
      source.stop().catch(() => undefined);
      activeSource = null;
      startCalibration();
    }, { once: true });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  // Grab DOM references.
  consentSection     = document.getElementById('view-consent')!;
  calibrationSection = document.getElementById('view-calibration')!;
  sceneSection       = document.getElementById('view-scene')!;
  reportSection      = document.getElementById('view-report')!;
  stopBtn            = document.getElementById('stop-btn') as HTMLButtonElement;
  demoBadge          = document.getElementById('demo-badge')!;
  errorModal         = document.getElementById('error-modal')!;
  errorMessage       = document.getElementById('error-message')!;
  errorCloseBtn      = document.getElementById('error-close-btn') as HTMLButtonElement;

  // Wire the Stop button (T-33).
  stopBtn.addEventListener('click', onStop);

  // Wire the error-modal close button.
  errorCloseBtn.addEventListener('click', () => {
    errorModal.hidden = true;
  });

  // Show the demo badge if demo mode is active.
  window.heartline.getDemoMode().then((dm) => {
    if (dm.active) {
      demoBadge.hidden = false;
    }
  }).catch(() => undefined);

  // ----- Step 1: show consent -----
  mountConsentScreen(consentSection);
  showView('view-consent');

  // ----- Step 2: move to calibration when consent is agreed -----
  consentSection.addEventListener('consent:agreed', () => {
    startCalibration();
  }, { once: true });

  // ----- Step 3: move to scene when calibration is done -----
  document.addEventListener('calibration:done', () => {
    // Phase 11 will wire the scene here.  For now navigate to scene stub.
    showView('view-scene');

    // Dispatch a 'scene:start' so Phase 11's SceneView can pick it up.
    sceneSection.dispatchEvent(
      new CustomEvent('scene:start', {
        bubbles: true,
        detail: { baseline: calibrationBaseline, source: activeSource },
      }),
    );
  }, { once: true });

  // ----- Step 4: move to report when scene ends -----
  document.addEventListener('scene:done', () => {
    showView('view-report');
    stopBtn.hidden = true;
  }, { once: true });
});
