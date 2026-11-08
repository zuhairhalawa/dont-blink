/**
 * kit/vitals/presence.ts
 *
 * Debounces raw "is a face there" samples into stable present/away changes,
 * so one missed detection frame doesn't count as looking away.
 *
 * Why this exists: in live tests (Nov 2026) the SmartSpectra SDK kept
 * reporting validation code 7 ("chest not visible") and steady blink data
 * even while the player turned away or left the frame, so the game could not
 * tell when they looked away. Face presence now comes from Chromium's
 * built-in on-device FaceDetector (see FaceWatch.ts), filtered here.
 */

export interface PresenceFilter {
  /**
   * Feed one sample. Returns the new state when it changes (true = face
   * present, false = away), otherwise null.
   */
  push(present: boolean, now: number): boolean | null;
  readonly present: boolean;
}

/**
 * @param goneAfterMs  Absence needed before reporting "away".
 * @param backAfterMs  Presence needed before reporting "present" again.
 */
export function createPresenceFilter(goneAfterMs = 450, backAfterMs = 250): PresenceFilter {
  let state = true;
  let since: number | null = null; // when the samples started disagreeing with `state`
  return {
    get present() {
      return state;
    },
    push(present, now) {
      if (present === state) {
        since = null;
        return null;
      }
      if (since === null) since = now;
      if (now - since >= (state ? goneAfterMs : backAfterMs)) {
        state = present;
        since = null;
        return state;
      }
      return null;
    },
  };
}
