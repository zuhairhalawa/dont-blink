/**
 * scripts/build.mjs: bundles Don't Blink with esbuild into dist/app/.
 *
 *   main     Node CJS; electron, the SDK and koffi stay external (native code)
 *   preload  Node CJS; only electron is external. Sandboxed preloads cannot
 *            require npm packages, so the SDK preload is bundled in.
 *   renderer browser IIFE
 *
 * Pass --probe to also build the blink-latency probe into dist/probe/.
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (...p) => path.join(root, ...p);
const common = { bundle: true, sourcemap: true, logLevel: 'warning', alias: { kit: src('kit') } };

async function buildApp(outDir, rendererEntry, htmlFile, cssFile) {
  fs.mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    ...common, entryPoints: [src('src/main/main.ts')], outfile: path.join(outDir, 'main.js'),
    platform: 'node', format: 'cjs', target: 'node20',
    external: ['electron', 'electron/*', '@smartspectra/node-sdk', '@smartspectra/node-sdk/*', 'koffi'],
  });
  await esbuild.build({
    ...common, entryPoints: [src('src/main/preload.ts')], outfile: path.join(outDir, 'preload.js'),
    platform: 'node', format: 'cjs', target: 'node20', external: ['electron', 'electron/*'],
  });
  await esbuild.build({
    ...common, entryPoints: [rendererEntry], outfile: path.join(outDir, 'renderer.js'),
    platform: 'browser', format: 'iife', target: 'chrome120',
  });
  fs.copyFileSync(htmlFile, path.join(outDir, 'index.html'));
  if (cssFile) fs.copyFileSync(cssFile, path.join(outDir, 'style.css'));
  console.log(`built ${path.relative(root, outDir)}/`);
}

await buildApp(src('dist/app'), src('src/renderer/app.ts'), src('src/renderer/index.html'), src('src/renderer/style.css'));

// Head tracking: MediaPipe's WASM runtime and the face model, served to the
// page by the main process (see 'load-asset' in src/main/main.ts).
fs.mkdirSync(src('dist/app/mediapipe'), { recursive: true });
fs.mkdirSync(src('dist/app/models'), { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  fs.copyFileSync(src('node_modules/@mediapipe/tasks-vision/wasm', f), src('dist/app/mediapipe', f));
}
for (const f of ['face_landmarker.task', 'selfie_segmenter.tflite']) {
  fs.copyFileSync(src('assets/models', f), src('dist/app/models', f));
}

if (process.argv.includes('--probe')) {
  // The probe page loads probe.js; keep that name.
  await buildApp(src('dist/probe'), src('src/probe.ts'), src('src/probe.html'), null);
  fs.renameSync(src('dist/probe/renderer.js'), src('dist/probe/probe.js'));
  fs.renameSync(src('dist/probe/renderer.js.map'), src('dist/probe/probe.js.map'));
}
