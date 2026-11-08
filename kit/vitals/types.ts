/**
 * kit/vitals/types.ts
 *
 * Shared data-model types for the heartline-kit.
 * All types flow top-to-bottom through the kit layers:
 *   VitalsSource → VitalsReading → signal processing → ReportData → export
 *
 * These are plain interfaces (no classes, no runtime code) so they can be
 * imported by any layer, including pure-function modules and tests, without
 * pulling in Electron or SDK dependencies.
 */

// ---------------------------------------------------------------------------
// § 3.1  VitalsReading
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// § 3.2  Baseline
// ---------------------------------------------------------------------------

/**
 * Average resting pulse and breathing rates computed during the calibration
 * phase (~20 s).  Either field is null when fewer than three valid readings
 * were available for that metric.
 */
export interface Baseline {
  /** Mean resting pulse rate in bpm; null if insufficient data. */
  pulseRate: number | null;
  /** Mean resting breathing rate in breaths/min; null if insufficient data. */
  breathingRate: number | null;
}

// ---------------------------------------------------------------------------
// § 3.3  Beat
// ---------------------------------------------------------------------------

/**
 * A single narrative beat in the Scare Meter scene script.
 * The scene player drives a requestAnimationFrame loop keyed to these entries.
 */
export interface Beat {
  /** Unique identifier, e.g. "knock" or "face". */
  id: string;
  /** Milliseconds from scene start when this beat begins. */
  startMs: number;
  /** Duration of this beat in milliseconds. */
  durationMs: number;
  /** Human-readable label shown in the report, e.g. "the knock". */
  label: string;
}

// ---------------------------------------------------------------------------
// § 3.4  TaggedReading
// ---------------------------------------------------------------------------

/**
 * A VitalsReading annotated with the beat that was active when it arrived.
 * `beatId` is null for readings taken before the first beat or between beats.
 */
export interface TaggedReading {
  reading: VitalsReading;
  /** ID of the active Beat, or null if none was active. */
  beatId: string | null;
}

// ---------------------------------------------------------------------------
// § 4.4  BeatChange  (used by signal/change.ts and ReportData)
// ---------------------------------------------------------------------------

/**
 * Absolute and percentage change from baseline for a window of readings.
 * All fields are null when baseline or current mean could not be computed.
 */
export interface BeatChange {
  /** Change in pulse rate (bpm); positive = faster than baseline. */
  pulseDeltaBpm: number | null;
  /** Percentage change in pulse rate relative to baseline. */
  pulseDeltaPct: number | null;
  /** Change in breathing rate (breaths/min); positive = faster than baseline. */
  breathingDeltaBpm: number | null;
  /** Percentage change in breathing rate relative to baseline. */
  breathingDeltaPct: number | null;
}

// ---------------------------------------------------------------------------
// § 3.5  BeatResult
// ---------------------------------------------------------------------------

/**
 * Per-beat analysis result combining the beat definition, deltas from
 * baseline, and the computed scare score.
 */
export interface BeatResult {
  /** The original beat definition. */
  beat: Beat;
  /** Pulse rate change in bpm from baseline; null if unavailable. */
  pulseDeltaBpm: number | null;
  /** Pulse rate change as a percentage of baseline; null if unavailable. */
  pulseDeltaPct: number | null;
  /** Breathing rate change in breaths/min from baseline; null if unavailable. */
  breathingDeltaBpm: number | null;
  /** Breathing rate change as a percentage of baseline; null if unavailable. */
  breathingDeltaPct: number | null;
  /**
   * Composite scare score on a 0–10 scale.
   * Formula: clamp(|pulsePct|*0.6 + |breathingPct|*0.4, 0, 50) / 5
   * Null inputs contribute 0.
   */
  scareScore: number;
}

// ---------------------------------------------------------------------------
// § 3.6  ReportData
// ---------------------------------------------------------------------------

/**
 * The complete data bundle produced after a Scare Meter session ends.
 * This is the payload serialised to JSON or baked into the HTML export.
 *
 * No API key or personal data should ever appear in this struct.
 */
export interface ReportData {
  /** ISO-8601 timestamp of when the session was completed. */
  sessionTimestamp: string;
  /** Resting-state readings measured during calibration. */
  calibrationBaseline: Baseline;
  /** Per-beat analysis for every beat in the scene. */
  beats: BeatResult[];
  /**
   * The three beats with the highest scareScore.
   * Fewer than three entries if fewer beats exist.
   */
  topScares: BeatResult[];
  /** Every reading from the scene tagged with the active beat. */
  taggedReadings: TaggedReading[];
  /**
   * AI-generated plain-text narrative summary of the session, or a
   * deterministic fallback string when Gemini is unavailable.
   */
  aiSummary: string;
}

// ---------------------------------------------------------------------------
// § 3.7  ConsentRecord
// ---------------------------------------------------------------------------

/**
 * An immutable record that the user agreed to the consent disclosure.
 * Stored in memory only; never written to disk or sent over the network.
 */
export interface ConsentRecord {
  /** True once the user clicks "I agree". Always true in a valid record. */
  agreed: boolean;
  /** ISO-8601 timestamp of when the user clicked "I agree". */
  timestamp: string;
}
