/**
 * kit/ui/LiveReadout.ts
 *
 * Vanilla HTML + inline SVG live readout for pulse and breathing rate.
 *
 * Features (AC-5.1–AC-5.6):
 *   • Pulse and breathing numbers with unit labels.
 *   • "no reading" state when valid is false or value is null.
 *   • 30-sample sparkline (inline SVG) for each metric.
 *   • Hint text area for SDK validation messages.
 *   • Disclaimer text from kit/ui/disclaimer.ts on every render.
 *   • No external library — pure DOM manipulation.
 *
 * Usage:
 *   const handle = mountLiveReadout(containerElement);
 *   source.on('reading', (r) => handle.update(r));
 *   source.on('hint',    (h) => handle.setHint(h.message));
 *   // …later…
 *   handle.destroy();
 */

import type { VitalsReading } from '../vitals/types';
import { DISCLAIMER_TEXT } from './disclaimer';
import { filterNonNull, computeSparkScale, buildSparkSegments } from './sparkline';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Returned by mountLiveReadout so the host can push new readings and hints. */
export interface LiveReadoutHandle {
  /** Push a new reading into the readout.  Redraws the sparkline and numbers. */
  update(reading: VitalsReading): void;
  /**
   * Set the hint text below the numbers.
   * Pass null to clear the hint area.
   */
  setHint(hint: string | null): void;
  /** Remove the readout from the DOM and release internal state. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of readings kept for the sparklines. */
const SPARKLINE_SAMPLES = 30;
/** SVG viewport dimensions (px). */
const SVG_W = 180;
const SVG_H = 40;
/** Padding inside the SVG so the polyline never clips. */
const SVG_PAD = 4;

// ---------------------------------------------------------------------------
// Mount function
// ---------------------------------------------------------------------------

/**
 * Render the live readout into `container` and return a handle to update it.
 *
 * @param container  The element to render into.  Its existing content is
 *                   replaced.
 */
export function mountLiveReadout(container: HTMLElement): LiveReadoutHandle {
  // Inject the initial HTML structure.
  container.innerHTML = buildShellHtml();

  // Grab the elements we'll update on every reading.
  const pulseValueEl  = container.querySelector<HTMLElement>('.hlr-pulse-value')!;
  const breathValueEl = container.querySelector<HTMLElement>('.hlr-breath-value')!;
  const pulseSparkEl  = container.querySelector<SVGSVGElement>('.hlr-pulse-spark')!;
  const breathSparkEl = container.querySelector<SVGSVGElement>('.hlr-breath-spark')!;
  const hintEl        = container.querySelector<HTMLElement>('.hlr-hint')!;

  // Circular buffers for the sparklines.
  const pulseHistory:  (number | null)[] = [];
  const breathHistory: (number | null)[] = [];

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function pushHistory(buf: (number | null)[], value: number | null): void {
    buf.push(value);
    if (buf.length > SPARKLINE_SAMPLES) {
      buf.shift();
    }
  }

  /**
   * Build an inline SVG polyline for the last N readings.
   *
   * Only non-null values are plotted.  Null slots are treated as gaps so the
   * polyline breaks rather than dipping to zero.  The non-null points are
   * spread evenly across the full SVG width (their condensed index is used for
   * the x-coordinate), so the line fills the viewport regardless of how many
   * readings have arrived so far.
   *
   * The y-axis is scaled to [min − padding, max + padding] of the visible
   * values, keeping the line centred even when all readings are identical.
   */
  function renderSparkline(
    svgEl: SVGSVGElement,
    history: (number | null)[],
    color: string,
  ): void {
    // Remove existing paths/polylines.
    while (svgEl.firstChild) {
      svgEl.removeChild(svgEl.firstChild);
    }

    const points = filterNonNull(history);
    if (points.length < 2) {
      return; // Not enough data for a line yet.
    }

    const { lo, range } = computeSparkScale(points);
    const plotW = SVG_W - SVG_PAD * 2;
    const plotH = SVG_H - SVG_PAD * 2;
    const lastCondensedIdx = points.length - 1;

    // Map condensed index (0..points.length-1) → x so points fill the width.
    function toX(condensedIdx: number): number {
      return SVG_PAD + (condensedIdx / lastCondensedIdx) * plotW;
    }
    // Map value → y (inverted: higher value = lower y in SVG coords).
    function toY(v: number): number {
      return SVG_PAD + plotH - ((v - lo) / range) * plotH;
    }

    for (const segment of buildSparkSegments(points)) {
      const coords = segment
        .map(p => `${toX(p.condensedIdx).toFixed(1)},${toY(p.value).toFixed(1)}`)
        .join(' ');
      const polyline = document.createElementNS(
        'http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', coords);
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', color);
      polyline.setAttribute('stroke-width', '1.5');
      polyline.setAttribute('stroke-linecap', 'round');
      polyline.setAttribute('stroke-linejoin', 'round');
      svgEl.appendChild(polyline);
    }
  }

  // -------------------------------------------------------------------------
  // Handle implementation
  // -------------------------------------------------------------------------

  function update(reading: VitalsReading): void {
    pushHistory(pulseHistory,  reading.pulseRate);
    pushHistory(breathHistory, reading.breathingRate);

    const NO_READING = 'no reading';

    // Update pulse number — show whenever the value is non-null, regardless of
    // valid (which reflects pulse stability only and is false on breathing-only
    // events).
    if (reading.pulseRate !== null) {
      pulseValueEl.textContent = `${Math.round(reading.pulseRate)} bpm`;
      pulseValueEl.classList.remove('hlr-no-reading');
    } else {
      pulseValueEl.textContent = NO_READING;
      pulseValueEl.classList.add('hlr-no-reading');
    }

    // Update breathing number — same rule: show when non-null.
    if (reading.breathingRate !== null) {
      breathValueEl.textContent = `${reading.breathingRate.toFixed(1)} br/min`;
      breathValueEl.classList.remove('hlr-no-reading');
    } else {
      breathValueEl.textContent = NO_READING;
      breathValueEl.classList.add('hlr-no-reading');
    }

    // Redraw sparklines.
    renderSparkline(pulseSparkEl,  pulseHistory,  '#e53935'); // red for pulse
    renderSparkline(breathSparkEl, breathHistory, '#1e88e5'); // blue for breathing
  }

  function setHint(hint: string | null): void {
    hintEl.textContent = hint ?? '';
    hintEl.style.display = hint ? '' : 'none';
  }

  function destroy(): void {
    container.innerHTML = '';
    pulseHistory.length  = 0;
    breathHistory.length = 0;
  }

  // Start with the hint hidden.
  setHint(null);

  return { update, setHint, destroy };
}

// ---------------------------------------------------------------------------
// HTML shell
// ---------------------------------------------------------------------------

function buildShellHtml(): string {
  return `
<style>
  .hlr-root {
    font-family: system-ui, sans-serif;
    color: #1a1a1a;
  }
  .hlr-metrics {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .hlr-metric {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 140px;
  }
  .hlr-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #555;
    font-weight: 600;
  }
  .hlr-value {
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 1;
  }
  .hlr-no-reading {
    font-size: 0.95rem;
    color: #888;
    font-weight: 400;
  }
  .hlr-pulse-value  { color: #c62828; }
  .hlr-breath-value { color: #1565c0; }
  .hlr-spark {
    display: block;
    width: ${SVG_W}px;
    height: ${SVG_H}px;
    /* Transparent so the sparkline floats on whatever the host card colour is.
       The host (app.css #calibration-readout) provides the background. */
    background: transparent;
    border-radius: 3px;
  }
  .hlr-hint {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: #e65100;
    background: #fff3e0;
    padding: 0.3rem 0.5rem;
    border-radius: 3px;
  }
  .hlr-disclaimer {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: #777;
  }
</style>
<div class="hlr-root">
  <div class="hlr-metrics">
    <div class="hlr-metric">
      <span class="hlr-label">Pulse</span>
      <span class="hlr-value hlr-pulse-value">no reading</span>
      <svg class="hlr-spark hlr-pulse-spark"
           viewBox="0 0 ${SVG_W} ${SVG_H}"
           xmlns="http://www.w3.org/2000/svg"
           aria-hidden="true"></svg>
    </div>
    <div class="hlr-metric">
      <span class="hlr-label">Breathing</span>
      <span class="hlr-value hlr-breath-value">no reading</span>
      <svg class="hlr-spark hlr-breath-spark"
           viewBox="0 0 ${SVG_W} ${SVG_H}"
           xmlns="http://www.w3.org/2000/svg"
           aria-hidden="true"></svg>
    </div>
  </div>
  <div class="hlr-hint" style="display:none"></div>
  <p class="hlr-disclaimer">${DISCLAIMER_TEXT}</p>
</div>
`.trim();
}
