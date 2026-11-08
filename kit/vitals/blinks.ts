/**
 * kit/vitals/blinks.ts
 *
 * Turns the SDK's blinking detections into blink events.
 *
 * Each metrics event carries `face.blinking`, a list of detection statuses
 * ({ detected, stable, timestamp }). A blink is the moment `detected` goes
 * from false to true. Measured on a laptop webcam (Nov 2026): every cued
 * blink was detected, and the SDK reports it about 100-150 ms after the eyes
 * close.
 */

/** One blinking detection status from the SDK. */
export interface BlinkStatus {
  detected?: boolean | null;
  stable?: boolean | null;
  timestamp?: number | { toString(): string } | null;
}

/** Streaming state: whether the eyes were closed in the last status seen. */
export interface BlinkTracker {
  /** Feed the statuses from one metrics event; returns blink onset times (ms). */
  push(statuses: readonly BlinkStatus[] | null | undefined): number[];
  reset(): void;
}

/** Convert an SDK timestamp (microseconds, number or Long) to milliseconds. */
export function usToMs(ts: BlinkStatus['timestamp']): number | null {
  if (ts === null || ts === undefined) return null;
  const n = typeof ts === 'number' ? ts : Number(ts.toString());
  return Number.isFinite(n) ? n / 1000 : null;
}

export function createBlinkTracker(): BlinkTracker {
  let closed = false;
  return {
    push(statuses) {
      const onsets: number[] = [];
      for (const s of statuses ?? []) {
        const detected = s.detected === true;
        if (detected && !closed) {
          const ms = usToMs(s.timestamp);
          if (ms !== null) onsets.push(ms);
        }
        closed = detected;
      }
      return onsets;
    },
    reset() {
      closed = false;
    },
  };
}
