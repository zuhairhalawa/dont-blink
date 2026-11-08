/**
 * apps/scare-meter/renderer/globals.d.ts
 *
 * Ambient type declarations for globals injected by preload.ts via
 * contextBridge.exposeInMainWorld.
 *
 * These declarations are picked up automatically by tsconfig.renderer.json
 * (which includes apps/scare-meter/renderer/**\/*) so app.ts and vitals.ts
 * can reference window.heartline without casting.
 *
 * Must stay in sync with the contextBridge exposition in preload.ts.
 */

import type { ReportData } from 'kit/vitals';

// ---------------------------------------------------------------------------
// Return types mirrored from preload.ts (kept inline to avoid importing the
// preload itself, which is a Node/CJS module incompatible with the renderer
// bundler config).
// ---------------------------------------------------------------------------

interface ExportResult {
  ok: boolean;
  path?: string;
  error?: string;
}

interface DemoModeResult {
  active: boolean;
  videoUrl: string | null;
}

// ---------------------------------------------------------------------------
// Global window extension
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    heartline: {
      /** Fetch the Presage API key from the main process. */
      getPresageApiKey(): Promise<string>;
      /** Ask Gemini (via main) for a plain-text summary of the session. */
      generateSummary(prompt: string): Promise<string>;
      /** Save an HTML string via a save dialog. */
      exportHtml(html: string): Promise<ExportResult>;
      /** Serialise ReportData to JSON and save via a save dialog. */
      exportJson(data: ReportData): Promise<ExportResult>;
      /** Return demo-mode state set at startup. */
      getDemoMode(): Promise<DemoModeResult>;
    };
  }
}
