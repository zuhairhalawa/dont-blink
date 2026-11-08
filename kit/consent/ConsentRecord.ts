/**
 * kit/consent/ConsentRecord.ts
 *
 * Immutable record that the user agreed to the consent disclosure, plus an
 * in-memory store for it.  Stored in memory only — never written to disk and
 * never sent over the network.
 *
 * API:
 *   setConsent(telemetry)  — create and store the record (call on "I agree").
 *   getConsentRecord()     — return the record, or null if consent was not given.
 */

/**
 * An immutable snapshot of the user's consent decision.
 * `agreed` is always true in a record that was actually stored — we only
 * store the record when the user clicks "I agree".
 */
export interface ConsentRecord {
  /** Always true in a valid record (stored only after the user agrees). */
  agreed: boolean;
  /** ISO-8601 timestamp of when the user clicked "I agree". */
  timestamp: string;
  /**
   * Whether the user chose to send Presage an anonymous per-session telemetry
   * summary.  Defaults to false (opt-in).  Passed to SmartSpectraSDK as
   * `enableTelemetry`.
   */
  telemetry: boolean;
}

/** Module-level store — null until the user gives consent. */
let _record: ConsentRecord | null = null;

/**
 * Create and store the consent record.
 * Call this exactly once, when the user clicks "I agree".
 * Calling it again overwrites the previous record (e.g. after a reset).
 *
 * @param telemetry  Whether the user opted in to anonymous SDK telemetry.
 *                   Defaults to false.
 */
export function setConsent(telemetry = false): void {
  _record = {
    agreed: true,
    timestamp: new Date().toISOString(),
    telemetry,
  };
}

/**
 * Return the stored consent record, or `null` if consent was never given
 * in this session.
 */
export function getConsentRecord(): ConsentRecord | null {
  return _record;
}
