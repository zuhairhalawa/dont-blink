/**
 * apps/scare-meter/preload.ts
 *
 * Preload script for the Scare Meter BrowserWindow.
 *
 * Two jobs:
 *   1. Require the SmartSpectra SDK preload, which installs its own
 *      contextBridge binding (`window.__smartspectraBridge`).  This must
 *      happen before any renderer code tries to construct `SmartSpectraSDK`.
 *
 *   2. Expose the `HeartlineApi` (design §5) as `window.heartline` via
 *      contextBridge.exposeInMainWorld.  The renderer calls these methods;
 *      they forward to IPC handlers registered in main.ts.
 *
 * Why we require the SDK preload here (not point directly at it):
 *   We need our own contextBridge bindings AND the SDK's binding on the same
 *   window.  Electron only supports one preload script per BrowserWindow, so
 *   we require the SDK's preload from ours to install both in one script run.
 *
 * Security:
 *   contextIsolation: true — this preload runs in a separate context from
 *   the renderer's main world.  exposeInMainWorld is the only way to share
 *   values across that boundary, so no Node APIs leak.
 *
 * T-28, design §5, AC-13.1.
 */

// Step 1 — install the SDK contextBridge binding.
// This sets up window.__smartspectraBridge used by @smartspectra/node-sdk/renderer.
// Must be called before the renderer module loads.
require('@smartspectra/node-sdk/preload');

import { contextBridge, ipcRenderer } from 'electron';
import type { ReportData } from 'kit/vitals/types';

// ---------------------------------------------------------------------------
// HeartlineApi — the surface exposed to the renderer as window.heartline
// ---------------------------------------------------------------------------

/**
 * Return type for export operations.
 * Defined here so the renderer can import it from the preload types if needed.
 */
export interface ExportResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Demo-mode status.
 */
export interface DemoModeResult {
  active: boolean;
  videoUrl: string | null;
}

// ---------------------------------------------------------------------------
// Step 2 — expose HeartlineApi
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld('heartline', {
  /**
   * Fetch the Presage API key from the main process.
   * Called once when the renderer is about to start capture.
   * The key must not be stored in any renderer global after it is handed
   * to RendererVitalsSource (AC-13.4).
   */
  getPresageApiKey(): Promise<string> {
    return ipcRenderer.invoke('get-presage-api-key') as Promise<string>;
  },

  /**
   * Ask the main process to call Gemini and return a plain-text summary.
   * The Gemini API key lives only in the main process; the renderer only
   * supplies the assembled prompt text.
   *
   * @param prompt  The assembled session data / prompt string.
   */
  generateSummary(prompt: string): Promise<string> {
    return ipcRenderer.invoke('generate-summary', prompt) as Promise<string>;
  },

  /**
   * Save an HTML string to a file chosen via a save dialog.
   * Returns { ok: true, path } on success, { ok: false, error? } on failure
   * or if the user cancelled.
   *
   * @param html  Self-contained HTML string from report/htmlExport.ts.
   */
  exportHtml(html: string): Promise<ExportResult> {
    return ipcRenderer.invoke('export-html', html) as Promise<ExportResult>;
  },

  /**
   * Serialise a ReportData object and save it to a JSON file chosen via a
   * save dialog.  Returns the same { ok, path? } shape as exportHtml.
   *
   * @param data  The ReportData to serialise.
   */
  exportJson(data: ReportData): Promise<ExportResult> {
    return ipcRenderer.invoke('export-json', data) as Promise<ExportResult>;
  },

  /**
   * Return the demo-mode state set at startup.
   * { active: false, videoUrl: null }  — live camera mode.
   * { active: true,  videoUrl: string } — demo mode; videoUrl is a file://
   *   URL the renderer assigns to a muted <video> element, then calls
   *   video.captureStream() to obtain the MediaStream for RendererVitalsSource.
   */
  getDemoMode(): Promise<DemoModeResult> {
    return ipcRenderer.invoke('get-demo-mode') as Promise<DemoModeResult>;
  },
});

// ---------------------------------------------------------------------------
// Extend the Window interface so renderer TypeScript code can see the API
// without an explicit cast.  (Placed here so it travels with the preload.)
// ---------------------------------------------------------------------------

// Note: this declaration augmentation only takes effect when the preload's
// type file is referenced.  The renderer can also declare it locally.
declare global {
  interface Window {
    heartline: {
      getPresageApiKey(): Promise<string>;
      generateSummary(prompt: string): Promise<string>;
      exportHtml(html: string): Promise<ExportResult>;
      exportJson(data: ReportData): Promise<ExportResult>;
      getDemoMode(): Promise<DemoModeResult>;
    };
  }
}
