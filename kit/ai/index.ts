/**
 * kit/ai/index.ts
 *
 * Single module that calls the Google Gemini REST API to generate a plain-text
 * summary.  Designed to be called only from the Electron main process so the
 * API key never reaches the renderer.
 *
 * Fallback contract (AC-6.5):
 *  - If no API key was supplied (initAi not called, or called with undefined),
 *    generateSummary returns a deterministic fallback string without touching
 *    the network.
 *  - If the network call fails (HTTP error or connection error), the same
 *    fallback path is used.
 *  - The fallback is deterministic: the returned string is derived only from
 *    the prompt length and the first 80 characters of the prompt, so tests
 *    can predict it without network access.
 */

/** Gemini model to use for all summary requests. */
const GEMINI_MODEL = 'gemini-2.0-flash';

/** Base URL for the Gemini REST generateContent endpoint. */
const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

/** Module-level key store — set once by initAi, used by generateSummary. */
let _apiKey: string | undefined;

/**
 * Initialise the AI module with the Gemini API key.
 * Call this once from the main process after loading .env.
 * Calling it with `undefined` (no key set) is allowed; generateSummary will
 * return the offline fallback in that case.
 *
 * @param apiKey  Value of GEMINI_API_KEY, or undefined if not configured.
 */
export function initAi(apiKey: string | undefined): void {
  _apiKey = apiKey;
}

/**
 * Generate a plain-text summary using Gemini, or return a deterministic
 * fallback string if no key is configured or the call fails.
 *
 * The fallback is intentionally simple so apps work offline and tests are
 * predictable.  It is NOT a meaningful summary — callers should always prefer
 * the real Gemini response when a key is available.
 *
 * @param prompt  The prompt to send to Gemini (e.g. assembled session data).
 * @returns       A plain-text summary string.  Never throws.
 */
export async function generateSummary(prompt: string): Promise<string> {
  // No-key path: return deterministic fallback without touching the network
  if (!_apiKey) {
    return buildFallback(prompt);
  }

  try {
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${_apiKey}`;

    const body = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // HTTP error (4xx / 5xx) — use fallback, do not propagate
      return buildFallback(prompt);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;

    // Extract text from the first candidate / first part
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof text === 'string' && text.trim().length > 0) {
      return text.trim();
    }

    // Unexpected empty response — fallback
    return buildFallback(prompt);
  } catch {
    // Network error, DNS failure, etc. — use fallback
    return buildFallback(prompt);
  }
}

/**
 * Build a deterministic fallback summary.
 *
 * The string is derived from:
 *  - The prompt length (so different prompts produce visibly different output).
 *  - The first 80 characters of the prompt (trimmed).
 *
 * This makes the output predictable in tests without requiring a real API key.
 *
 * @param prompt  The original prompt.
 * @returns       A plain-text fallback string.
 */
function buildFallback(prompt: string): string {
  const preview = prompt.slice(0, 80).trim();
  return (
    `[Offline summary — Gemini unavailable] ` +
    `Prompt length: ${prompt.length} chars. ` +
    `Preview: "${preview}"`
  );
}
