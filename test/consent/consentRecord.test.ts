/**
 * test/consent/consentRecord.test.ts
 *
 * Unit tests for kit/consent/ConsentRecord.
 * Covers:
 *   - getConsentRecord() returns null before consent is given
 *   - setConsent() stores a valid record with agreed=true and a timestamp
 *   - telemetry defaults to false when setConsent() is called with no argument
 *   - telemetry is stored as true when setConsent(true) is called
 *   - telemetry is stored as false when setConsent(false) is called explicitly
 *   - calling setConsent() again overwrites the previous record
 */

import { describe, it, expect, beforeEach } from 'vitest';

// We re-import the module functions each time, but the module-level _record
// persists across imports within the same Vitest worker.  We reset state by
// calling setConsent() with known args, or by relying on the null check before
// any setConsent() call.  For isolation we use a fresh import via resetModules
// in beforeEach via dynamic import.

describe('ConsentRecord', () => {
  // Use dynamic imports so each test group gets a fresh module with _record=null.
  // Vitest resets modules between describe blocks only when resetModules is set;
  // we manage this manually with vi.resetModules().

  // Shared references reset in beforeEach
  let setConsent: (telemetry?: boolean) => void;
  let getConsentRecord: () => { agreed: boolean; timestamp: string; telemetry: boolean } | null;

  beforeEach(async () => {
    // Reset module registry so _record is null at the start of each test.
    const { vi } = await import('vitest');
    vi.resetModules();
    const mod = await import('kit/consent/ConsentRecord');
    setConsent = mod.setConsent;
    getConsentRecord = mod.getConsentRecord;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('returns null before consent is given', () => {
    expect(getConsentRecord()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // agreed and timestamp
  // -------------------------------------------------------------------------

  it('stores agreed=true after setConsent()', () => {
    setConsent();
    expect(getConsentRecord()?.agreed).toBe(true);
  });

  it('stores a valid ISO-8601 timestamp', () => {
    const before = Date.now();
    setConsent();
    const after = Date.now();
    const record = getConsentRecord();
    const ts = new Date(record!.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  // -------------------------------------------------------------------------
  // telemetry field
  // -------------------------------------------------------------------------

  it('defaults telemetry to false when called with no argument', () => {
    setConsent();
    expect(getConsentRecord()?.telemetry).toBe(false);
  });

  it('stores telemetry=false when setConsent(false) is called', () => {
    setConsent(false);
    expect(getConsentRecord()?.telemetry).toBe(false);
  });

  it('stores telemetry=true when setConsent(true) is called', () => {
    setConsent(true);
    expect(getConsentRecord()?.telemetry).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Overwrite behaviour
  // -------------------------------------------------------------------------

  it('overwrites the previous record on a second call', () => {
    setConsent(false);
    expect(getConsentRecord()?.telemetry).toBe(false);

    setConsent(true);
    expect(getConsentRecord()?.telemetry).toBe(true);
  });

  it('returns the same object from multiple getConsentRecord() calls', () => {
    setConsent(true);
    const first = getConsentRecord();
    const second = getConsentRecord();
    expect(first).toBe(second);
  });
});
