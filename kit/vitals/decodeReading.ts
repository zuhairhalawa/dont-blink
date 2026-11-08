/**
 * kit/vitals/decodeReading.ts
 *
 * Maps a raw protobuf buffer from the SmartSpectra SDK `metrics` event into a
 * typed VitalsReading.
 *
 * FIELD NAMES — verified by reading:
 *   node_modules/@smartspectra/node-sdk/js/messages/generated.d.ts
 *
 *   Pulse rate:
 *     metrics.cardio        → presage.smartspectra.ICardio  (line 1749, IMetrics)
 *     metrics.cardio.pulseRate
 *                           → IMeasurementWithConfidence[]  (line 1585, ICardio)
 *     Entry fields: .value (number), .confidence (number 0–100), .stable (boolean)
 *
 *   Breathing rate:
 *     metrics.breathing     → presage.smartspectra.IBreathing  (line 1737, IMetrics)
 *     metrics.breathing.rate
 *                           → IMeasurementWithConfidence[]  (line 958, IBreathing)
 *     Entry fields: .value (number), .confidence (number 0–100), .stable (boolean)
 *
 * VALIDITY strategy:
 *   We treat a reading as valid when at least one pulse-rate entry has
 *   `.stable === true`.  If no cardio data is present, the reading is invalid.
 *   This mirrors the SDK's own definition of "stable" for heart rate
 *   (confidence >= 40, accuracy ±3 bpm; see the arterial pressure model card).
 *
 * READING VALUE strategy:
 *   We take the last entry from the array (most recent measurement in the
 *   window) as the current value.  If the array is empty or the field is
 *   absent entirely, we return null for that metric.
 */

import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import type { VitalsReading } from './types';

/**
 * Decode a Metrics protobuf buffer emitted by the SDK's `metrics` event and
 * map it to a VitalsReading.
 *
 * @param buf          Raw protobuf bytes from the SDK `metrics` event.
 * @param timestampUs  Microsecond timestamp from the SDK (same event argument).
 * @returns            A VitalsReading with null fields where the SDK produced
 *                     no value for that metric.
 */
export function decodeReading(buf: Uint8Array, timestampUs: number): VitalsReading {
  // Convert microseconds → milliseconds for our timestamp field.
  const timestamp = timestampUs / 1000;

  const metrics = decodeMetrics(buf);

  // ------------------------------------------------------------------
  // Pulse rate  (metrics.cardio.pulseRate — IMeasurementWithConfidence[])
  // ------------------------------------------------------------------
  const pulseEntries = metrics.cardio?.pulseRate;
  const lastPulse = (pulseEntries && pulseEntries.length > 0)
    ? pulseEntries[pulseEntries.length - 1]
    : undefined;

  const pulseRate: number | null =
    lastPulse !== undefined && typeof lastPulse.value === 'number'
      ? lastPulse.value
      : null;

  // ------------------------------------------------------------------
  // Breathing rate  (metrics.breathing.rate — IMeasurementWithConfidence[])
  // ------------------------------------------------------------------
  const breathingEntries = metrics.breathing?.rate;
  const lastBreathing = (breathingEntries && breathingEntries.length > 0)
    ? breathingEntries[breathingEntries.length - 1]
    : undefined;

  const breathingRate: number | null =
    lastBreathing !== undefined && typeof lastBreathing.value === 'number'
      ? lastBreathing.value
      : null;

  // ------------------------------------------------------------------
  // Valid flag — true when the most recent pulse-rate entry is stable.
  // Fall back to false when no cardio data is present.
  // ------------------------------------------------------------------
  const valid: boolean = lastPulse?.stable === true;

  return { timestamp, pulseRate, breathingRate, valid };
}
