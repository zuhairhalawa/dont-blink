/**
 * test/vitals/decodeReading.test.ts
 *
 * Unit tests for kit/vitals/decodeReading.ts (T-20).
 *
 * We mock '@smartspectra/node-sdk/messages' so tests do not need the native
 * module, Electron, or a real camera.
 *
 * Branches covered (T-20 requirements):
 *   1. Both pulse and breathing present and valid  → correct VitalsReading
 *   2. Pulse absent (no cardio field)              → pulseRate is null
 *   3. Breathing absent (no breathing field)       → breathingRate is null
 *   4. Valid flag false (stable not true)          → valid is false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @smartspectra/node-sdk/messages before importing decodeReading so that
// the module resolver never tries to load the native binary.
// ---------------------------------------------------------------------------
vi.mock('@smartspectra/node-sdk/messages', () => ({
  decodeMetrics: vi.fn(),
}));

// Import AFTER mocking so the module sees our stub.
import { decodeReading } from 'kit/vitals/decodeReading';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

// Typed cast for the mock so we can call .mockReturnValue on it.
const mockDecodeMetrics = decodeMetrics as ReturnType<typeof vi.fn>;

// A minimal stub Uint8Array — decodeReading passes it straight to decodeMetrics.
const STUB_BUF = new Uint8Array([0x00]);
// 1 000 000 µs = 1000 ms
const STUB_TS_US = 1_000_000;

beforeEach(() => {
  mockDecodeMetrics.mockReset();
});

// ---------------------------------------------------------------------------
// Helper builders for mock Metrics objects
// ---------------------------------------------------------------------------

function makePulseEntry(value: number, stable: boolean) {
  return { value, stable, confidence: 80, timestamp: STUB_TS_US };
}

function makeBreathingEntry(value: number, stable: boolean) {
  return { value, stable, confidence: 75, timestamp: STUB_TS_US };
}

// ---------------------------------------------------------------------------
// 1. Both fields present and valid → correct VitalsReading
// ---------------------------------------------------------------------------

describe('decodeReading', () => {
  it('maps both pulse and breathing when both are present and stable', () => {
    mockDecodeMetrics.mockReturnValue({
      cardio: {
        pulseRate: [makePulseEntry(72, true)],
      },
      breathing: {
        rate: [makeBreathingEntry(14, true)],
      },
    });

    const result = decodeReading(STUB_BUF, STUB_TS_US);

    expect(result.pulseRate).toBe(72);
    expect(result.breathingRate).toBe(14);
    expect(result.valid).toBe(true);
    // Timestamp converted from µs to ms
    expect(result.timestamp).toBe(1000);
  });

  it('uses the last entry when the cardio array has multiple measurements', () => {
    mockDecodeMetrics.mockReturnValue({
      cardio: {
        pulseRate: [
          makePulseEntry(70, true),
          makePulseEntry(75, true),  // last → should win
        ],
      },
      breathing: {
        rate: [makeBreathingEntry(14, true)],
      },
    });

    const result = decodeReading(STUB_BUF, STUB_TS_US);
    expect(result.pulseRate).toBe(75);
  });

  // -------------------------------------------------------------------------
  // 2. Pulse absent → pulseRate is null
  // -------------------------------------------------------------------------

  it('returns pulseRate null when cardio field is absent', () => {
    mockDecodeMetrics.mockReturnValue({
      // no cardio
      breathing: {
        rate: [makeBreathingEntry(14, true)],
      },
    });

    const result = decodeReading(STUB_BUF, STUB_TS_US);

    expect(result.pulseRate).toBeNull();
    expect(result.breathingRate).toBe(14);
    // No pulse data → valid is false
    expect(result.valid).toBe(false);
  });

  it('returns pulseRate null when cardio.pulseRate array is empty', () => {
    mockDecodeMetrics.mockReturnValue({
      cardio: { pulseRate: [] },
      breathing: { rate: [makeBreathingEntry(16, true)] },
    });

    const result = decodeReading(STUB_BUF, STUB_TS_US);
    expect(result.pulseRate).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 3. Breathing absent → breathingRate is null
  // -------------------------------------------------------------------------

  it('returns breathingRate null when breathing field is absent', () => {
    mockDecodeMetrics.mockReturnValue({
      cardio: {
        pulseRate: [makePulseEntry(68, true)],
      },
      // no breathing
    });

    const result = decodeReading(STUB_BUF, STUB_TS_US);

    expect(result.breathingRate).toBeNull();
    expect(result.pulseRate).toBe(68);
  });

  it('returns breathingRate null when breathing.rate array is empty', () => {
    mockDecodeMetrics.mockReturnValue({
      cardio: { pulseRate: [makePulseEntry(68, true)] },
      breathing: { rate: [] },
    });

    const result = decodeReading(STUB_BUF, STUB_TS_US);
    expect(result.breathingRate).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 4. Validity flag false → valid is false
  // -------------------------------------------------------------------------

  it('sets valid to false when the last pulse entry has stable === false', () => {
    mockDecodeMetrics.mockReturnValue({
      cardio: {
        pulseRate: [makePulseEntry(74, false)],  // stable: false
      },
      breathing: {
        rate: [makeBreathingEntry(15, true)],
      },
    });

    const result = decodeReading(STUB_BUF, STUB_TS_US);

    expect(result.valid).toBe(false);
    // The value is still decoded even when not stable
    expect(result.pulseRate).toBe(74);
  });

  it('sets valid to false when stable is undefined (not set by SDK)', () => {
    mockDecodeMetrics.mockReturnValue({
      cardio: {
        pulseRate: [{ value: 71, confidence: 30, timestamp: STUB_TS_US }],
        // no 'stable' field → undefined
      },
      breathing: {
        rate: [makeBreathingEntry(13, true)],
      },
    });

    const result = decodeReading(STUB_BUF, STUB_TS_US);
    expect(result.valid).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Timestamp conversion
  // -------------------------------------------------------------------------

  it('converts timestampUs from microseconds to milliseconds', () => {
    mockDecodeMetrics.mockReturnValue({
      cardio: { pulseRate: [makePulseEntry(70, true)] },
      breathing: { rate: [makeBreathingEntry(14, true)] },
    });

    // 5 500 000 µs → 5500 ms
    const result = decodeReading(STUB_BUF, 5_500_000);
    expect(result.timestamp).toBe(5500);
  });
});
