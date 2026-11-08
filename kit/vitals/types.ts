/**
 * kit/vitals/types.ts: the reading every part of the game shares.
 */

/**
 * A single decoded reading from the Presage SmartSpectra SDK.
 *
 * `pulseRate` and `breathingRate` are null when the SDK did not produce a
 * value for that metric in this frame (e.g. face not fully visible yet).
 *
 * `valid` is false when the SDK's own validity flag is absent or when a
 * `validationStatus` event indicated a quality problem.
 */
export interface VitalsReading {
  /** Unix timestamp in milliseconds (derived from the SDK's microsecond ts). */
  timestamp: number;
  /** Pulse rate in beats per minute; null if the SDK did not produce a value. */
  pulseRate: number | null;
  /** Breathing rate in breaths per minute; null if the SDK did not produce a value. */
  breathingRate: number | null;
  /** False if the SDK validity flag is absent or a validationStatus event fired. */
  valid: boolean;
}
