/**
 * apps/scare-meter/main.ts
 *
 * Electron main process entry point for Scare Meter.
 *
 * Startup sequence (design §6):
 *   1. Load .env (PRESAGE_API_KEY, GEMINI_API_KEY).
 *   2. If PRESAGE_API_KEY is missing → open a setup window and stop.
 *   3. Parse --demo <path> from process.argv; validate the file exists.
 *   4. Create the main BrowserWindow with security settings from tech.md.
 *   5. Call bindSmartSpectraIpc(window) — the only SDK work the main process does.
 *   6. Call initAi(GEMINI_API_KEY).
 *   7. Set permission handler (media only for our own file:// pages).
 *   8. Set CSP via webRequest.onHeadersReceived.
 *   9. Register all IPC handlers (design §5).
 *
 * Security contract (tech.md):
 *   contextIsolation: true, sandbox: true, nodeIntegration: false.
 *   PRESAGE_API_KEY is returned only from the get-presage-api-key handler.
 *   GEMINI_API_KEY never leaves the main process.
 *
 * T-25, T-26, T-27.
 */

// ---- load .env before anything else ----------------------------------------
import 'dotenv/config';

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
} from 'electron';

import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main';
import { initAi, generateSummary } from 'kit/ai/index';
import type { ReportData } from 'kit/vitals/types';

// ---------------------------------------------------------------------------
// Read environment variables (loaded by dotenv above)
// ---------------------------------------------------------------------------
const PRESAGE_API_KEY: string | undefined = process.env['PRESAGE_API_KEY'];
const GEMINI_API_KEY: string | undefined = process.env['GEMINI_API_KEY'];

// ---------------------------------------------------------------------------
// Demo-mode state — parsed from process.argv before app:ready
// ---------------------------------------------------------------------------
let demoActive = false;
let demoVideoUrl: string | null = null;

/**
 * Parse --demo <path> from argv.
 * argv[0] = electron binary, argv[1] = script, user flags start at argv[2].
 * Returns the file path string, or null if --demo was not supplied.
 */
function parseDemoArg(): string | null {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--demo');
  if (idx === -1) return null;
  const demoPath = args[idx + 1];
  return typeof demoPath === 'string' && demoPath.length > 0 ? demoPath : null;
}

// ---------------------------------------------------------------------------
// App ready
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // ------ Validate demo arg before creating any window ---------------------
  const demoArg = parseDemoArg();
  if (demoArg !== null) {
    try {
      fs.accessSync(demoArg, fs.constants.R_OK);
      demoActive = true;
      // Convert to a file:// URL the renderer can load into a <video> element.
      demoVideoUrl = pathToFileURL(path.resolve(demoArg)).href;
    } catch {
      // File not accessible — show an error dialog and exit cleanly.
      dialog.showErrorBox(
        'Demo file not found',
        `Could not open demo file:\n${demoArg}\n\nPlease provide a valid, readable video path.`,
      );
      app.exit(1);
      return;
    }
  }

  // ------ If no API key, show setup page and stop --------------------------
  if (!PRESAGE_API_KEY) {
    const setupWin = new BrowserWindow({
      width: 560,
      height: 400,
      resizable: false,
      webPreferences: {
        // Setup page is a simple local HTML file with no Node access needed.
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    // Load a minimal setup page from dist (created during build/Phase 10).
    // If it doesn't exist yet, show a plain error-box instead.
    const setupHtmlPath = path.join(__dirname, 'setup.html');
    if (fs.existsSync(setupHtmlPath)) {
      void setupWin.loadFile(setupHtmlPath);
    } else {
      dialog.showErrorBox(
        'API key required',
        'PRESAGE_API_KEY is not set.\n\nCreate a .env file in the project root with:\n  PRESAGE_API_KEY=your_key_here\n  GEMINI_API_KEY=your_gemini_key_here\n\nThen restart the app.',
      );
      app.exit(1);
    }
    return;
  }

  // ------ Initialise Gemini AI (may be undefined — fallback still works) ---
  initAi(GEMINI_API_KEY);

  // ------ Create the main window -------------------------------------------
  const mainWindow = createMainWindow();

  // ------ Wire SmartSpectra IPC (the only SDK work the main process does) --
  bindSmartSpectraIpc(mainWindow);

  // ------ Register permission + CSP handlers (T-27) ------------------------
  registerSecurityHandlers();

  // ------ Register IPC handlers (T-26) -------------------------------------
  registerIpcHandlers(PRESAGE_API_KEY);

  // Reload the window on activate (macOS convention).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createMainWindow();
      bindSmartSpectraIpc(win);
    }
  });
}).catch((err: unknown) => {
  console.error('[scare-meter] startup error:', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  // On macOS apps stay alive until the user explicitly quits.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// Window factory
// ---------------------------------------------------------------------------
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // Security (tech.md): contextIsolation + sandbox, no Node in renderer.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Point at our preload which also require()s the SDK preload.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the renderer shell page.
  const indexHtml = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexHtml)) {
    void win.loadFile(indexHtml);
  } else {
    // Phase 10 hasn't run yet; show a plain placeholder.
    void win.loadURL('data:text/html,<h1>Scare Meter</h1><p>Run npm run build to generate the renderer.</p>');
  }

  return win;
}

// ---------------------------------------------------------------------------
// T-27: Permission handler + CSP
// ---------------------------------------------------------------------------

/**
 * Register the session-level security handlers:
 *   - Allow `media` only for our own file:// pages; deny everything else.
 *   - Inject a strict CSP header on all responses so no inline scripts run
 *     except what the SDK needs (worker-src blob:).
 *
 * AC-13.2, AC-13.3.
 */
function registerSecurityHandlers(): void {
  const ses = session.defaultSession;

  // --- Permission handler: media only for file:// pages -------------------
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (
      permission === 'media' &&
      typeof details.requestingUrl === 'string' &&
      details.requestingUrl.startsWith('file://')
    ) {
      // Grant camera/microphone access only to our own local pages.
      callback(true);
      return;
    }
    // Deny everything else (geolocation, notifications, etc.).
    callback(false);
  });

  // --- CSP via response headers -------------------------------------------
  // We add headers to every request rather than relying on a meta tag so that
  // the policy is enforced even if the renderer is compromised.
  // worker-src blob: is required by the SmartSpectra SDK's web workers.
  ses.webRequest.onHeadersReceived((details, respond) => {
    respond({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "worker-src blob:; " +
          "img-src 'self' data:; " +
          "media-src 'self' blob: file:; " +
          "connect-src 'self';",
        ],
      },
    });
  });
}

// ---------------------------------------------------------------------------
// T-26: IPC handlers
// ---------------------------------------------------------------------------

/**
 * Register all IPC handlers the renderer calls through window.heartline.
 *
 * Channels:
 *   get-presage-api-key  — return the PRESAGE_API_KEY (never log it)
 *   generate-summary     — delegate to generateSummary() in kit/ai
 *   export-html          — showSaveDialog then write the HTML string
 *   export-json          — showSaveDialog then write JSON-serialised ReportData
 *   get-demo-mode        — return { active, videoUrl }
 *
 * Design §5.
 */
function registerIpcHandlers(presageApiKey: string): void {
  // ---- get-presage-api-key ------------------------------------------------
  // The renderer calls this once when starting capture.  The key is passed
  // to RendererVitalsSource and not stored globally in the renderer (AC-13.4).
  ipcMain.handle('get-presage-api-key', () => {
    // Return the key, but never log it.
    return presageApiKey;
  });

  // ---- generate-summary ---------------------------------------------------
  // The Gemini key lives only in the main process; the renderer passes only
  // the assembled prompt text.
  ipcMain.handle('generate-summary', async (_event, prompt: unknown) => {
    if (typeof prompt !== 'string') {
      throw new TypeError('generate-summary: prompt must be a string');
    }
    return generateSummary(prompt);
  });

  // ---- export-html --------------------------------------------------------
  ipcMain.handle('export-html', async (_event, html: unknown) => {
    if (typeof html !== 'string') {
      throw new TypeError('export-html: html must be a string');
    }

    const result = await dialog.showSaveDialog({
      title: 'Save report as HTML',
      defaultPath: `scare-meter-report-${dateSuffix()}.html`,
      filters: [{ name: 'HTML Files', extensions: ['html'] }],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false };
    }

    try {
      await fs.promises.writeFile(result.filePath, html, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // ---- export-json --------------------------------------------------------
  ipcMain.handle('export-json', async (_event, data: unknown) => {
    // data arrives as a plain object (serialised across IPC boundary).
    // We accept it as ReportData — the renderer is trusted to supply the
    // correct shape since IPC data is structured-cloned, not eval'd.
    const reportData = data as ReportData;

    const result = await dialog.showSaveDialog({
      title: 'Save report as JSON',
      defaultPath: `scare-meter-report-${dateSuffix()}.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false };
    }

    try {
      const json = JSON.stringify(reportData, null, 2);
      await fs.promises.writeFile(result.filePath, json, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // ---- get-demo-mode ------------------------------------------------------
  ipcMain.handle('get-demo-mode', () => {
    return {
      active: demoActive,
      videoUrl: demoVideoUrl,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a YYYYMMDD-HHMMSS suffix for export file names. */
function dateSuffix(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}
