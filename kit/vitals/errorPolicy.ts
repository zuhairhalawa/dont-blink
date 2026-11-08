/**
 * kit/vitals/errorPolicy.ts
 *
 * Decides what to do with an SDK `error` event. Before this existed, every
 * error except a bad key was only written to the console, so a session could
 * die silently (seen in a Heartline Kit live run: "SmartSpectra is not in a
 * valid state for this operation" thirty times a second, nothing on screen).
 *
 * Codes come from SmartSpectraErrorCode in @smartspectra/node-sdk 3.4.0.
 */

export type ErrorAction =
  | { kind: 'fatal'; message: string }
  | { kind: 'transient' };

const MESSAGES: Record<number, string> = {
  1: 'The camera session stopped unexpectedly. Restart the game to try again.',
  2: 'The Presage API key was rejected. Check PRESAGE_API_KEY in your .env file.',
  3: 'The Presage SDK could not be configured. Restart the game to try again.',
  4: 'The Presage free-trial limit for this key has been reached.',
  5: 'Lost the connection to Presage. Check your internet connection and restart.',
  6: 'Presage reported a server problem. Try again in a few minutes.',
  7: 'The camera stopped sending video. Check that no other app is using it.',
  8: 'The Presage SDK stopped processing video. Restart the game to try again.',
  9: 'The camera sent video in a format the SDK could not read.',
  10: 'Video frames arrived out of order.',
  11: 'There was a gap in the video frames.',
};

/** Codes that end the session even when the SDK marks them retryable. */
const ALWAYS_FATAL = new Set([2, 3, 4, 7]);

/**
 * Classify an SDK error.
 *
 * - kAuthenticationFailed, kConfigurationFailed, kCreditExhausted and
 *   kInputUnavailable are always fatal.
 * - Anything else is transient while the SDK says it is retrying, and fatal
 *   once it is not retryable.
 */
export function classifySdkError(code: number, retryable: boolean): ErrorAction {
  const message = MESSAGES[code] ?? `The Presage SDK reported error ${code}. Restart the game to try again.`;
  if (ALWAYS_FATAL.has(code)) return { kind: 'fatal', message };
  if (retryable) return { kind: 'transient' };
  return { kind: 'fatal', message };
}
