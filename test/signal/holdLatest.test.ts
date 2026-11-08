/**
 * test/signal/holdLatest.test.ts
 *
 * Unit tests for holdLatest and createHoldLatestState (kit/signal/holdLatest.ts).
 *
 * Scenarios tested:
 *   - Empty array → null
 *   - Single reading with both fields null
 *   - Single reading with pulse only
 *   - Single reading with breathing only
 *   - Two readings where each carries a different metric
 *   - Stale pulse is dropped; fresh breathing is kept
 *   - Stale breathing is dropped; fresh pulse is kept
 *   - Both values stale → both null
 *   - valid flag comes from the last reading regardless of which had a value
 *   - createHoldLatestState: accumulates over time
 *   - createHoldLatestState: TTL drops stale value
 *   - createHoldLatestState: reset clears state
 *   - createHoldLatestState: update held value with newer reading
 */

import { describe, it, expect } from 'vitest';
import { holdLatest, createHoldLatestState } from 'kit/signal';
import type { VitalsReading } from 'kit/vitals';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r(
  timestamp: number,
  pulseRate: number | null,
  breathingRate: number | null,
  valid = true,
): VitalsReading {
  return { timestamp, pulseRate, breathingRate, valid };
}

// ---------------------------------------------------------------------------
// holdLatest (pure batch function)
// ---------------------------------------------------------------------------

describe('holdLatest', () => {
  it('returns null for an empty array', () => {
    expect(holdLatest([])).toBeNull();
  });

  it('returns a reading with both null when the single entry has no values', () => {
    const result = holdLatest([r(1000, null, null)]);
    expect(result).not.toBeNull();
    expect(result!.pulseRate).toBeNull();
    expect(result!.breathingRate).toBeNull();
    expect(result!.timestamp).toBe(1000);
  });

  it('carries pulse rate when only one reading has it', () => {
    const result = holdLatest([r(1000, 90, null)]);
    expect(result!.pulseRate).toBe(90);
    expect(result!.breathingRate).toBeNull();
  });

  it('carries breathing rate when only one reading has it', () => {
    const result = holdLatest([r(1000, null, 16)]);
    expect(result!.pulseRate).toBeNull();
    expect(result!.breathingRate).toBe(16);
  });

  it('merges pulse from an earlier reading and breathing from a later reading', () => {
    const readings = [
      r(1000, 88, null),   // pulse event
      r(1500, null, 16),   // breathing event
    ];
    const result = holdLatest(readings);
    expect(result!.pulseRate).toBe(88);
    expect(result!.breathingRate).toBe(16);
    // Timestamp is from the last reading.
    expect(result!.timestamp).toBe(1500);
  });

  it('merges breathing from an earlier reading and pulse from a later reading', () => {
    const readings = [
      r(1000, null, 16),   // breathing event
      r(1500, 88, null),   // pulse event
    ];
    const result = holdLatest(readings);
    expect(result!.pulseRate).toBe(88);
    expect(result!.breathingRate).toBe(16);
  });

  it('picks the most-recent pulse when multiple pulse readings exist', () => {
    const readings = [
      r(1000, 88, null),
      r(1200, 90, null),
      r(1400, null, 16),
    ];
    const result = holdLatest(readings);
    expect(result!.pulseRate).toBe(90); // second pulse wins
  });

  it('drops stale pulse but keeps fresh breathing', () => {
    const ttl = 5_000;
    const readings = [
      r(0,      88, null),   // pulse at t=0 — older than TTL
      r(6_000,  null, 16),   // breathing at t=6000 — fresh (within TTL of last)
    ];
    // last.timestamp = 6000, cutoff = 6000 - 5000 = 1000
    // pulseTs = 0 < 1000 → stale; breathingTs = 6000 >= 1000 → fresh
    const result = holdLatest(readings, ttl);
    expect(result!.pulseRate).toBeNull();
    expect(result!.breathingRate).toBe(16);
  });

  it('drops stale breathing but keeps fresh pulse', () => {
    const ttl = 5_000;
    const readings = [
      r(0,      null, 16),  // breathing at t=0 — stale
      r(6_000,  88, null),  // pulse at t=6000 — fresh
    ];
    const result = holdLatest(readings, ttl);
    expect(result!.pulseRate).toBe(88);
    expect(result!.breathingRate).toBeNull();
  });

  it('drops both values when both are outside the TTL', () => {
    const ttl = 5_000;
    const readings = [
      r(0,      88, 16),    // both present at t=0
      r(10_000, null, null), // empty reading at t=10000
    ];
    // cutoff = 10000 - 5000 = 5000; both values at t=0 < 5000 → stale
    const result = holdLatest(readings, ttl);
    expect(result!.pulseRate).toBeNull();
    expect(result!.breathingRate).toBeNull();
  });

  it('uses valid flag from the last reading, not from the reading that had a value', () => {
    const readings = [
      r(1000, 88, null, true),   // valid pulse
      r(1500, null, null, false), // invalid empty reading
    ];
    const result = holdLatest(readings);
    expect(result!.valid).toBe(false); // last reading was invalid
    expect(result!.pulseRate).toBe(88); // but value is still held
  });

  it('value held at exactly the TTL boundary is kept (boundary is inclusive for >=)', () => {
    const ttl = 5_000;
    // pulseTs = 0; last.timestamp = 5000; cutoff = 0; 0 >= 0 → kept
    const readings = [
      r(0,     88, null),
      r(5_000, null, null),
    ];
    const result = holdLatest(readings, ttl);
    expect(result!.pulseRate).toBe(88);
  });
});

// ---------------------------------------------------------------------------
// createHoldLatestState (streaming stateful version)
// ---------------------------------------------------------------------------

describe('createHoldLatestState', () => {
  it('returns null fields until a value arrives', () => {
    const hold = createHoldLatestState();
    const merged = hold.push(r(1000, null, null));
    expect(merged.pulseRate).toBeNull();
    expect(merged.breathingRate).toBeNull();
  });

  it('holds pulse from first event and merges with breathing from second', () => {
    const hold = createHoldLatestState();
    hold.push(r(1000, 88, null));
    const merged = hold.push(r(1500, null, 16));
    expect(merged.pulseRate).toBe(88);
    expect(merged.breathingRate).toBe(16);
    expect(merged.timestamp).toBe(1500);
  });

  it('holds breathing from first event and merges with pulse from second', () => {
    const hold = createHoldLatestState();
    hold.push(r(1000, null, 16));
    const merged = hold.push(r(1500, 88, null));
    expect(merged.pulseRate).toBe(88);
    expect(merged.breathingRate).toBe(16);
  });

  it('updates held pulse when a newer pulse value arrives', () => {
    const hold = createHoldLatestState();
    hold.push(r(1000, 88, null));
    const merged = hold.push(r(1500, 92, null));
    expect(merged.pulseRate).toBe(92);
  });

  it('drops stale pulse when TTL expires', () => {
    const ttl = 5_000;
    const hold = createHoldLatestState(ttl);
    hold.push(r(0, 88, null));
    // Next reading at t=6000: cutoff = 6000 - 5000 = 1000; pulseTs=0 < 1000 → stale
    const merged = hold.push(r(6_000, null, 16));
    expect(merged.pulseRate).toBeNull();
    expect(merged.breathingRate).toBe(16);
  });

  it('drops stale breathing when TTL expires', () => {
    const ttl = 5_000;
    const hold = createHoldLatestState(ttl);
    hold.push(r(0, null, 16));
    const merged = hold.push(r(6_000, 88, null));
    expect(merged.pulseRate).toBe(88);
    expect(merged.breathingRate).toBeNull();
  });

  it('reset clears both held values so subsequent push starts fresh', () => {
    const hold = createHoldLatestState();
    hold.push(r(1000, 88, 16));
    hold.reset();
    const merged = hold.push(r(2000, null, null));
    expect(merged.pulseRate).toBeNull();
    expect(merged.breathingRate).toBeNull();
  });

  it('value held exactly at the TTL boundary is kept', () => {
    const ttl = 5_000;
    const hold = createHoldLatestState(ttl);
    hold.push(r(0, 88, null));
    // t=5000, cutoff=0, pulseTs=0 >= 0 → kept
    const merged = hold.push(r(5_000, null, null));
    expect(merged.pulseRate).toBe(88);
  });

  it('valid flag reflects the incoming reading, not the one that had the value', () => {
    const hold = createHoldLatestState();
    hold.push(r(1000, 88, null, true));
    const merged = hold.push(r(1500, null, null, false));
    expect(merged.valid).toBe(false);
    expect(merged.pulseRate).toBe(88); // value still held
  });
});
