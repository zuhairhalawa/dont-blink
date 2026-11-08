/**
 * kit/consent/ConsentScreen.ts
 *
 * Plain-HTML consent screen that satisfies AC-2.1–AC-2.4.
 *
 * Required disclosure points:
 *   1. What is measured (pulse rate and breathing rate from your webcam).
 *   2. Video processing (on-device; no frames uploaded; SDK goes online only
 *      to check the API key and, if enabled, send an anonymous telemetry
 *      summary).
 *   3. What it is NOT (not a medical device, not a diagnosis).
 *   4. How to stop (the Stop button is visible at any time after this screen).
 *   5. Optional Gemini summary (numbers sent to Google's API if a key is set).
 *
 * Usage:
 *   mountConsentScreen(container)
 *     — renders the consent UI into `container`.
 *     — on "I agree", calls setConsent(telemetry) and dispatches
 *       'consent:agreed' on `container` so the host can react.
 *
 * No framework dependency.  Inline CSS keeps everything self-contained.
 */

import { setConsent } from './ConsentRecord';

/**
 * Render the consent screen into `container` and wire up the "I agree" button.
 *
 * Dispatches the custom DOM event `consent:agreed` on `container` when the
 * user clicks "I agree".
 *
 * @param container  The element to render into.  Its existing content is
 *                   replaced.
 */
export function mountConsentScreen(container: HTMLElement): void {
  container.innerHTML = buildHtml();

  const button = container.querySelector<HTMLButtonElement>('#consent-agree-btn');
  if (!button) {
    // Should never happen — the HTML we injected always has the button.
    throw new Error('ConsentScreen: agree button not found after mount');
  }

  button.addEventListener('click', () => {
    // Read the telemetry checkbox state before storing consent.
    const telemetryBox = container.querySelector<HTMLInputElement>('#consent-telemetry');
    const telemetry = telemetryBox?.checked ?? false;

    // Record the time of consent and the user's telemetry choice
    // (in memory only — never persisted).
    setConsent(telemetry);

    // Notify the host that the user agreed so it can proceed to calibration.
    const event = new CustomEvent('consent:agreed', { bubbles: true });
    container.dispatchEvent(event);
  }, { once: true });
}

/** Build the consent screen HTML string. */
function buildHtml(): string {
  return `
<style>
  #consent-root {
    box-sizing: border-box;
    max-width: 600px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    font-family: system-ui, sans-serif;
    /* Dark theme — matches the app's dark background */
    color: #e8e8e8;
    background: #1e1e2e;
    border: 1px solid #333350;
    border-radius: 8px;
  }
  #consent-root h1 {
    font-size: 1.4rem;
    margin: 0 0 1rem;
    color: #ffffff;
  }
  #consent-root p {
    margin: 0 0 0.75rem;
    line-height: 1.6;
    font-size: 1rem;
  }
  #consent-root ul {
    margin: 0 0 1.25rem 1.25rem;
    padding: 0;
    line-height: 1.7;
    font-size: 1rem;
  }
  #consent-root li {
    margin-bottom: 0.6rem;
  }
  #consent-root .notice {
    background: #2a2a3e;
    border-left: 3px solid #7b7bff;
    padding: 0.75rem 1rem;
    border-radius: 2px;
    margin: 0 0 1.25rem;
    font-size: 0.95rem;
    line-height: 1.6;
  }
  #consent-root .telemetry-row {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    margin: 0 0 1.25rem;
    font-size: 1rem;
    line-height: 1.6;
    color: #c8c8d8;
  }
  #consent-root .telemetry-row input[type="checkbox"] {
    margin-top: 0.25rem;
    width: 1.1rem;
    height: 1.1rem;
    flex-shrink: 0;
    accent-color: #7b7bff;
    cursor: pointer;
  }
  #consent-root .telemetry-row label {
    cursor: pointer;
  }
  #consent-agree-btn {
    display: inline-block;
    padding: 0.65rem 1.5rem;
    background: #4c4cff;
    color: #ffffff;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  #consent-agree-btn:hover {
    background: #3a3ad4;
  }
</style>
<div id="consent-root">
  <h1>Before we start</h1>

  <p>This app uses your webcam to measure your <strong>pulse rate</strong> and
  <strong>breathing rate</strong> in real time. Please read the points below
  before continuing.</p>

  <ul>
    <!-- Disclosure 1: what is measured -->
    <li><strong>What is measured.</strong>
      Your webcam captures live video so the app can estimate your pulse rate
      (beats per minute) and breathing rate (breaths per minute) from subtle
      colour changes in your face.</li>

    <!-- Disclosure 2: where frames go (corrected: on-device) -->
    <li><strong>Video stays on this computer.</strong>
      The SmartSpectra SDK processes video <strong>on this device</strong>.
      Raw frames and face images are never uploaded anywhere, and this app
      saves no frames. The SDK does need an internet connection to verify the
      API key. Only if you tick the box below does it also send Presage one
      anonymous summary per session — the SDK version, frame rates, and how
      the session ended — with no video, no readings, and no name or device
      identifier.</li>

    <!-- Disclosure 3: not a medical device -->
    <li><strong>Not a medical device.</strong>
      These readings are for wellness and entertainment purposes only.
      They are <em>not</em> a medical diagnosis and should not be used to make
      health decisions.</li>

    <!-- Disclosure 4: how to stop -->
    <li><strong>You can stop at any time.</strong>
      A <strong>Stop</strong> button is visible on every screen after this one.
      Clicking it immediately stops the camera and ends the session.</li>

    <!-- Disclosure 5: optional Gemini summary -->
    <li><strong>Optional written summary.</strong>
      If a Gemini API key is configured, the session report's written summary
      is created by sending your session's numbers (pulse and breathing changes
      per scene moment, no video, no name) to Google's Gemini API. Without a
      key nothing is sent, and the app writes the summary itself.</li>
  </ul>

  <!-- Telemetry opt-in checkbox (unchecked by default = off) -->
  <div class="telemetry-row">
    <input type="checkbox" id="consent-telemetry" name="consent-telemetry" />
    <label for="consent-telemetry">
      Send Presage an anonymous usage summary (no video, no readings).
    </label>
  </div>

  <div class="notice">
    By clicking &ldquo;I agree&rdquo; you confirm you have read the points
    above and consent to your webcam video being processed as described.
  </div>

  <button id="consent-agree-btn" type="button">I agree — start session</button>
</div>
`.trim();
}
