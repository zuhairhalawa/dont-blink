/**
 * kit/vitals/VitalsSource.ts
 *
 * Defines the VitalsSource interface that every vitals source must implement.
 * A VitalsSource wraps whatever underlying mechanism delivers physiological
 * readings (live camera via SmartSpectra SDK, or a recorded video in demo
 * mode), and exposes them as a uniform stream of typed events.
 *
 * Design §4.1.
 *
 * Note: VitalsSource extends TinyEmitter (kit/vitals/TinyEmitter.ts) rather
 * than Node's built-in EventEmitter so it can be bundled for the browser
 * renderer without pulling in a Node polyfill.
 */

import type { VitalsReading } from './types';
import { TinyEmitter } from './TinyEmitter';

// Re-export VitalsReading so callers can import from 'kit/vitals/VitalsSource'
// without also needing to know about 'kit/vitals/types'.
export type { VitalsReading };

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

export interface VitalsSourceEvents {
  /** Emitted for every decoded reading from the SDK. */
  reading: (r: VitalsReading) => void;
  /**
   * Emitted when the SDK's `validationStatus` event fires.
   * Contains a short human-readable hint (e.g. "face not found").
   * The UI should display this to help the user reposition themselves.
   */
  hint: (h: { code: string; message: string }) => void;
  /**
   * Emitted for unrecoverable errors (e.g. kAuthenticationFailed).
   * The app should stop the source and show an error modal.
   * Not emitted for recoverable warnings like kNonMonotonicTimestamp.
   */
  fatalError: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// VitalsSource interface
// ---------------------------------------------------------------------------

/**
 * A vitals source: starts/stops producing VitalsReading events.
 * Implemented by RendererVitalsSource (renderer process, SDK-backed).
 *
 * Extends TinyEmitter<VitalsSourceEvents> so callers can use
 * .on(), .once(), .off(), and .emit() with typed event signatures.
 */
export interface VitalsSource extends TinyEmitter<VitalsSourceEvents> {
  start(): Promise<void>;
  stop(): Promise<void>;
}
