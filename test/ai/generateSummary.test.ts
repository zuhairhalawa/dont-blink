/**
 * test/ai/generateSummary.test.ts
 *
 * Unit tests for initAi / generateSummary (kit/ai/index.ts).
 *
 * Three paths tested:
 *   1. Success path     — fetch succeeds, returns Gemini text.
 *   2. Offline fallback — fetch throws (network error), returns fallback.
 *   3. No-key fallback  — initAi not called / called with undefined, returns fallback.
 *   4. HTTP error       — fetch returns a non-ok response, returns fallback.
 *   5. Empty response   — Gemini returns 200 but no usable text, returns fallback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We re-import the module fresh in each test via a dynamic import so that the
// module-level `_apiKey` state is reset.  Vitest supports module isolation via
// vi.resetModules().

describe('generateSummary', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset global fetch mock between tests
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. No-key fallback (initAi not called, or called with undefined)
  // -----------------------------------------------------------------------

  it('returns a fallback string when no API key is configured', async () => {
    const { generateSummary } = await import('kit/ai/index');
    // initAi NOT called — _apiKey remains undefined

    const prompt = 'Summarise the scare session.';
    const result = await generateSummary(prompt);

    expect(result).toContain('[Offline summary');
    expect(result).toContain(`${prompt.length} chars`);
    // Should not have called fetch at all
    // (global.fetch is not overridden, so if it were called it would fail naturally)
  });

  it('returns a fallback string when initAi is called with undefined', async () => {
    const { initAi, generateSummary } = await import('kit/ai/index');
    initAi(undefined);

    const prompt = 'Test prompt for undefined key.';
    const result = await generateSummary(prompt);

    expect(result).toContain('[Offline summary');
  });

  // -----------------------------------------------------------------------
  // 2. Success path — fetch returns valid Gemini JSON
  // -----------------------------------------------------------------------

  it('returns the Gemini response text on a successful API call', async () => {
    const fakeText = 'The viewer was most scared during "the knock" beat.';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: fakeText }],
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { initAi, generateSummary } = await import('kit/ai/index');
    initAi('fake-api-key-123');

    const result = await generateSummary('Describe what scared the viewer most.');
    expect(result).toBe(fakeText);
    expect(mockFetch).toHaveBeenCalledOnce();
    // Confirm key is embedded in the URL, not the body
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('key=fake-api-key-123');
    expect(calledUrl).toContain('gemini-2.0-flash');
  });

  // -----------------------------------------------------------------------
  // 3. Offline fallback — fetch throws (network error)
  // -----------------------------------------------------------------------

  it('returns a fallback string when fetch throws a network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const { initAi, generateSummary } = await import('kit/ai/index');
    initAi('some-key');

    const prompt = 'A prompt that will never reach Gemini.';
    const result = await generateSummary(prompt);

    expect(result).toContain('[Offline summary');
    expect(result).toContain(`${prompt.length} chars`);
  });

  // -----------------------------------------------------------------------
  // 4. HTTP error — fetch returns non-ok response
  // -----------------------------------------------------------------------

  it('returns a fallback string on an HTTP error response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too Many Requests' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { initAi, generateSummary } = await import('kit/ai/index');
    initAi('quota-exhausted-key');

    const prompt = 'Rate-limited prompt.';
    const result = await generateSummary(prompt);

    expect(result).toContain('[Offline summary');
    expect(result).toContain(`${prompt.length} chars`);
  });

  // -----------------------------------------------------------------------
  // 5. Empty / unexpected response — Gemini 200 but no usable text
  // -----------------------------------------------------------------------

  it('returns a fallback when the Gemini response has no text content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),  // empty candidates
    });
    vi.stubGlobal('fetch', mockFetch);

    const { initAi, generateSummary } = await import('kit/ai/index');
    initAi('valid-key');

    const prompt = 'Empty response test.';
    const result = await generateSummary(prompt);

    expect(result).toContain('[Offline summary');
  });

  it('returns a fallback when candidates text is an empty string', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '   ' }] } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { initAi, generateSummary } = await import('kit/ai/index');
    initAi('valid-key');

    const result = await generateSummary('Whitespace text test.');
    expect(result).toContain('[Offline summary');
  });

  // -----------------------------------------------------------------------
  // Fallback is deterministic
  // -----------------------------------------------------------------------

  it('fallback string contains a preview of the first 80 chars of the prompt', async () => {
    const { generateSummary } = await import('kit/ai/index');
    // No key → always fallback

    const longPrompt = 'A'.repeat(200);
    const result = await generateSummary(longPrompt);

    // Preview should be truncated to 80 chars
    expect(result).toContain('A'.repeat(80));
    expect(result).not.toContain('A'.repeat(81));
  });
});
