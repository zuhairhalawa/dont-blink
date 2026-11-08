/**
 * src/main/main.ts
 *
 * Electron main process for Don't Blink.
 *
 * The main process does four things:
 *   1. Loads PRESAGE_API_KEY from .env and hands it to the renderer through
 *      one IPC call, because the SmartSpectra renderer SDK needs it.
 *   2. Calls bindSmartSpectraIpc(win), the only SDK work done here.
 *   3. Allows camera access for our own file:// page only, and sets a strict CSP.
 *   4. Saves the end card PNG through a save dialog when the player asks.
 *
 * Renderer console warnings and errors are copied to stdout so test runs and
 * bug reports capture SDK errors.
 */

import 'dotenv/config';

import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer } from 'electron';
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main';

const PRESAGE_API_KEY = process.env['PRESAGE_API_KEY'];

// Enables Chromium's built-in on-device FaceDetector, used to notice when the
// player turns away from the screen (kit/vitals/FaceWatch.ts).
app.commandLine.appendSwitch('enable-experimental-web-platform-features');

app.whenReady().then(() => {
  if (!PRESAGE_API_KEY) {
    dialog.showErrorBox(
      'Presage API key needed',
      'PRESAGE_API_KEY is not set.\n\nCopy .env.example to .env in the project folder, add your free key from ' +
        'https://physiology.presagetech.com, then start the game again.',
    );
    app.exit(1);
    return;
  }

  registerSecurityHandlers();
  registerIpcHandlers(PRESAGE_API_KEY);

  const win = createWindow();
  bindSmartSpectraIpc(win);
}).catch((err: unknown) => {
  console.error('[dont-blink] startup error:', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  app.quit();
  // If a native SDK callback keeps the process alive, exit anyway.
  setTimeout(() => app.exit(0), 3000).unref();
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#050506',
    title: "Don't Blink",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Copy renderer warnings and errors to stdout (level 2 = warning, 3 = error).
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log(`[renderer ${level === 3 ? 'error' : 'warn'}] ${message}`);
  });

  // Close cleanly: ask the page to stop the camera and the Presage SDK first.
  // Closing with the SDK still running crashed the process on exit (a native
  // callback fired after shutdown). If the page doesn't answer in 2 s, close anyway.
  let closing = false;
  win.on('close', (e) => {
    if (closing) return;
    closing = true;
    e.preventDefault();
    win.webContents.send('app-closing');
    const force = setTimeout(() => app.exit(0), 2000);
    ipcMain.once('ready-to-close', () => {
      clearTimeout(force);
      // Exit straight away: letting Electron tear down normally gave the SDK's
      // native code a chance to call back into JavaScript during shutdown,
      // which crashed the process (FATAL napi_throw).
      app.exit(0);
    });
  });

  // Test-only: --no-tracking runs without the MediaPipe trackers.
  const query: Record<string, string> = process.argv.includes('--no-tracking') ? { notrack: '1' } : {};
  const metricsArg = process.argv.find((x) => x.startsWith('--metrics='));
  if (metricsArg) query['metrics'] = metricsArg.slice('--metrics='.length);
  // Round recorder: getDisplayMedia() in the page always captures this window
  // and nothing else (no picker, no other windows or screens).
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['window'] }).then((sources) => {
      // Match by title: the id from getMediaSourceId() did not match exactly.
      const mine = sources.find((s) => s.id === win.getMediaSourceId())
        ?? sources.find((s) => s.name === win.getTitle());
      callback(mine ? { video: mine } : {});
    }).catch(() => callback({}));
  });

  void win.loadFile(path.join(__dirname, 'index.html'), { query });
  return win;
}

function registerSecurityHandlers(): void {
  const ses = session.defaultSession;

  // Camera only, and only for our own local page.
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback((permission === 'media' || permission === 'display-capture') && details.requestingUrl.startsWith('file://'));
  });

  ses.webRequest.onHeadersReceived((details, respond) => {
    respond({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
            "worker-src blob:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:;",
        ],
      },
    });
  });
}

function registerIpcHandlers(presageApiKey: string): void {
  // The renderer asks once, when the camera starts. Never logged.
  ipcMain.handle('get-presage-api-key', () => presageApiKey);

  // Head tracking (MediaPipe Face Landmarker) needs its WASM runtime and model.
  // The sandboxed page can't fetch file:// URLs, so the main process reads
  // these named files from the build folder and nothing else.
  const ASSETS: Record<string, string> = {
    'mediapipe-loader': 'mediapipe/vision_wasm_internal.js',
    'mediapipe-wasm': 'mediapipe/vision_wasm_internal.wasm',
    'face-model': 'models/face_landmarker.task',
    'segment-model': 'models/selfie_segmenter.tflite',
    // Photo-real Watcher images, if generated (assets/watcher-src).
    ...Object.fromEntries(['stand', 'tilt', 'reach', 'hunch', 'lean', 'scream'].map((p) => [`watcher-${p}`, `watcher/watcher-${p}.png`])),
  };
  ipcMain.handle('load-asset', async (_event, name: unknown) => {
    const rel = typeof name === 'string' ? ASSETS[name] : undefined;
    if (!rel) throw new Error('Unknown asset');
    return new Uint8Array(await fs.promises.readFile(path.join(__dirname, rel)));
  });

  // Save the end card. The renderer sends a PNG data URL; nothing is written
  // unless the player picks a location.
  // Save a recorded round. Nothing is written unless the player picks a place.
  ipcMain.handle('save-video', async (_event, bytes: unknown, ext: unknown) => {
    if (!(bytes instanceof Uint8Array)) return { ok: false, error: 'Not a video.' };
    const e = ext === 'mp4' ? 'mp4' : 'webm';
    const result = await dialog.showSaveDialog({
      title: 'Save the round video',
      defaultPath: `dont-blink-round-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${e}`,
      filters: [{ name: e === 'mp4' ? 'MP4 video' : 'WebM video', extensions: [e] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      await fs.promises.writeFile(result.filePath, bytes);
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('save-png', async (_event, dataUrl: unknown) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      return { ok: false, error: 'Not a PNG image.' };
    }
    const result = await dialog.showSaveDialog({
      title: 'Save your end card',
      defaultPath: `dont-blink-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
      await fs.promises.writeFile(result.filePath, bytes);
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
