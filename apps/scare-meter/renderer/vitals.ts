/**
 * apps/scare-meter/renderer/vitals.ts
 *
 * Single point of entry for creating and managing a RendererVitalsSource in
 * the renderer process.
 *
 * Responsibilities:
 *   1. Ask the main process for the Presage API key via window.heartline.
 *   2. Ask the main process whether demo mode is active.
 *   3. Obtain a MediaStream:
 *        Live mode  — navigator.mediaDevices.getUserMedia({ video: true })
 *        Demo mode  — create a muted <video> element, set its src to the
 *                     file:// URL returned by getDemoMode(), wait for the
 *                     video to be ready, then call video.captureStream().
 *   4. Construct a RendererVitalsSource with the key + stream.
 *   5. Return the source so app.ts can subscribe to its events and manage
 *      its lifecycle.
 *
 * The API key is NOT stored in any module-level variable after it is passed
 * into RendererVitalsSource.  (AC-13.4)
 *
 * T-30, design §4.2, design §7, AC-12.1.
 */

import { RendererVitalsSource } from 'kit/vitals';
import { getConsentRecord } from 'kit/consent/ConsentRecord';

// globals.d.ts in this directory declares window.heartline for TypeScript.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise a RendererVitalsSource and return it ready to start.
 *
 * Call this after the user has agreed to the consent screen; do not call it
 * before, because getUserMedia will trigger the browser permission prompt.
 *
 * @throws If the Presage API key is empty, the user denies camera access,
 *         or a demo video URL cannot be loaded.
 */
export async function initVitals(): Promise<RendererVitalsSource> {
  // --- 1. Fetch API key and demo-mode status in parallel. ---
  const [apiKey, demoMode] = await Promise.all([
    window.heartline.getPresageApiKey(),
    window.heartline.getDemoMode(),
  ]);

  if (!apiKey) {
    throw new Error(
      'Presage API key is not set. Add PRESAGE_API_KEY to your .env file.',
    );
  }

  // --- 2. Obtain a MediaStream. ---
  let stream: MediaStream;

  if (demoMode.active && demoMode.videoUrl) {
    stream = await streamFromDemoVideo(demoMode.videoUrl);
  } else {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
  }

  // --- 3. Construct the source (key is only held inside the instance). ---
  // Telemetry follows the consent-screen checkbox; off unless the user ticked it.
  const telemetry = getConsentRecord()?.telemetry === true;
  const source = new RendererVitalsSource(apiKey, stream, telemetry);

  // The key reference goes out of scope here; the only remaining reference is
  // inside the RendererVitalsSource instance, satisfying AC-13.4.
  return source;
}

// ---------------------------------------------------------------------------
// Demo-mode helper
// ---------------------------------------------------------------------------

/**
 * Create a muted <video> element, point it at `videoUrl`, wait for metadata
 * to load, then return the stream produced by video.captureStream().
 *
 * The <video> is appended off-screen so it does not affect layout.
 */
function streamFromDemoVideo(videoUrl: string): Promise<MediaStream> {
  return new Promise<MediaStream>((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.style.position = 'absolute';
    video.style.left = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.setAttribute('aria-hidden', 'true');

    video.addEventListener(
      'loadedmetadata',
      () => {
        // captureStream() returns the MediaStream that the SDK will consume.
        // The cast is needed because TypeScript's lib.dom.d.ts may not yet
        // include captureStream() on HTMLVideoElement in older TS versions.
        const stream = (video as HTMLVideoElement & {
          captureStream(): MediaStream;
        }).captureStream();
        video.play().catch(() => {
          /* Non-fatal if autoplay is blocked — the stream is still valid. */
        });
        resolve(stream);
      },
      { once: true },
    );

    video.addEventListener(
      'error',
      () => {
        reject(
          new Error(
            `Demo video failed to load: ${videoUrl}\n` +
              'Check that the file exists and is a supported format (.webm, .mp4).',
          ),
        );
      },
      { once: true },
    );

    video.src = videoUrl;
    document.body.appendChild(video);
    video.load();
  });
}
