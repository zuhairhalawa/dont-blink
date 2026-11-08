import { describe, it, expect } from 'vitest';
import { createBlinkTracker, usToMs } from '../../kit/vitals/blinks';
import { classifySdkError } from '../../kit/vitals/errorPolicy';

describe('blink tracker', () => {
  it('reports the onset of each blink once', () => {
    const t = createBlinkTracker();
    expect(t.push([{ detected: false, timestamp: 1_000_000 }])).toEqual([]);
    expect(t.push([{ detected: true, timestamp: 2_000_000 }, { detected: true, timestamp: 2_033_000 }])).toEqual([2000]);
    expect(t.push([{ detected: true, timestamp: 2_066_000 }])).toEqual([]);
    expect(t.push([{ detected: false, timestamp: 2_100_000 }, { detected: true, timestamp: 2_400_000 }])).toEqual([2400]);
  });

  it('handles missing lists, nulls and Long-like timestamps', () => {
    const t = createBlinkTracker();
    expect(t.push(undefined)).toEqual([]);
    expect(t.push(null)).toEqual([]);
    expect(t.push([{ detected: true, timestamp: { toString: () => '5000000' } }])).toEqual([5000]);
    t.reset();
    expect(t.push([{ detected: true, timestamp: null }])).toEqual([]);
  });

  it('converts microseconds to milliseconds', () => {
    expect(usToMs(1_500_000)).toBe(1500);
    expect(usToMs(undefined)).toBeNull();
    expect(usToMs({ toString: () => 'x' })).toBeNull();
  });
});

describe('SDK error policy', () => {
  it.each([2, 3, 4, 7])('code %i is fatal even when retryable', (code) => {
    expect(classifySdkError(code, true).kind).toBe('fatal');
    expect(classifySdkError(code, false).kind).toBe('fatal');
  });

  it.each([1, 5, 6, 8, 9, 10, 11, 99])('code %i is transient while retrying and fatal once not', (code) => {
    expect(classifySdkError(code, true).kind).toBe('transient');
    const fatal = classifySdkError(code, false);
    expect(fatal.kind).toBe('fatal');
    if (fatal.kind === 'fatal') expect(fatal.message.length).toBeGreaterThan(10);
  });

  it('explains the free-trial limit in plain words', () => {
    const a = classifySdkError(4, false);
    expect(a.kind === 'fatal' && a.message).toMatch(/free-trial limit/);
  });
});
