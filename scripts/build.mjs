/**
 * scripts/build.mjs
 *
 * Bundles all three Scare Meter entry points with esbuild:
 *
 *   main    — Node, CommonJS, electron external  → dist/scare-meter/main.js
 *   preload — Node, CommonJS, electron external, SDK preload bundled → dist/scare-meter/preload.js
 *   renderer— Browser, IIFE                      → dist/scare-meter/renderer.js
 *
 * Then copies any static assets (index.html, *.css) from
 * apps/scare-meter/renderer/ into dist/scare-meter/.
 *
 * Why the SmartSpectra preload is bundled into ours:
 *   With sandbox: true, Electron's preload can require('electron') and a few
 *   built-ins, but not packages from node_modules. The SDK's preload entry
 *   (js/preload/index.js) only requires 'electron', so bundling it is safe.
 *
 * Run: node scripts/build.mjs
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'scare-meter');

// Ensure output directory exists.
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Helper: resolve a source path relative to repo root
// ---------------------------------------------------------------------------
function src(...parts) {
  return path.join(root, ...parts);
}

// ---------------------------------------------------------------------------
// Shared esbuild options
// ---------------------------------------------------------------------------
const commonOptions = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  // Resolve kit/* alias to ./kit/ (mirrors tsconfig paths)
  alias: {
    'kit': src('kit'),
  },
};

// ---------------------------------------------------------------------------
// 1. Main process
// ---------------------------------------------------------------------------
await esbuild.build({
  ...commonOptions,
  entryPoints: [src('apps', 'scare-meter', 'main.ts')],
  outfile: path.join(outDir, 'main.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Electron (and its sub-modules) must stay external — they're provided by
  // the Electron runtime, not bundleable.
  // @smartspectra/node-sdk and koffi load native binaries (.node files) that
  // esbuild cannot bundle; they are require()d from node_modules at runtime.
  external: ['electron', 'electron/*', '@smartspectra/node-sdk', '@smartspectra/node-sdk/*', 'koffi'],
});

// ---------------------------------------------------------------------------
// 2. Preload
// ---------------------------------------------------------------------------
await esbuild.build({
  ...commonOptions,
  entryPoints: [src('apps', 'scare-meter', 'preload.ts')],
  outfile: path.join(outDir, 'preload.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Only electron is external. With sandbox: true a preload script can require
  // 'electron' but not npm packages, so the SmartSpectra preload (whose only
  // dependency is require('electron')) is bundled into this file. Found on the
  // first launch: "module not found: @smartspectra/node-sdk/preload".
  external: ['electron', 'electron/*'],
});

// ---------------------------------------------------------------------------
// 3. Renderer
// ---------------------------------------------------------------------------
await esbuild.build({
  ...commonOptions,
  entryPoints: [src('apps', 'scare-meter', 'renderer', 'index.ts')],
  outfile: path.join(outDir, 'renderer.js'),
  platform: 'browser',
  format: 'iife',
  target: 'chrome108', // Electron 28 ships Chromium 120; 108 is a safe floor
  // @smartspectra/node-sdk/renderer is a pure-browser package — bundle it.
  // No node_modules are external here unless they try to use Node APIs.
});

// ---------------------------------------------------------------------------
// 4. Copy static assets (HTML, CSS) from the renderer source directory
//    into dist/scare-meter/.  Gracefully skips files that don't exist yet
//    (Phase 10 adds index.html and app.css).
// ---------------------------------------------------------------------------
const rendererSrc = src('apps', 'scare-meter', 'renderer');
const staticExts = ['.html', '.css'];

function copyIfExists(srcFile, destFile) {
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, destFile);
    console.log(`Copied: ${path.relative(root, srcFile)} → ${path.relative(root, destFile)}`);
  }
}

// Walk renderer directory for static files
if (fs.existsSync(rendererSrc)) {
  for (const entry of fs.readdirSync(rendererSrc)) {
    const ext = path.extname(entry).toLowerCase();
    if (staticExts.includes(ext)) {
      copyIfExists(
        path.join(rendererSrc, entry),
        path.join(outDir, entry),
      );
    }
  }
}

console.log(`\nBuild complete → ${path.relative(root, outDir)}/`);
