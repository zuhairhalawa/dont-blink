// Builds the blink-latency probe into dist/probe/, reusing the Scare Meter main and preload
// (they load index.html from their own folder and hand the Presage key to the renderer).
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'probe');
fs.mkdirSync(out, { recursive: true });
const common = { bundle: true, sourcemap: true, logLevel: 'warning', alias: { kit: path.join(root, 'kit') } };

await esbuild.build({ ...common, entryPoints: [path.join(root, 'apps/scare-meter/main.ts')], outfile: path.join(out, 'main.js'),
  platform: 'node', format: 'cjs', target: 'node20',
  external: ['electron', 'electron/*', '@smartspectra/node-sdk', '@smartspectra/node-sdk/*', 'koffi'] });
await esbuild.build({ ...common, entryPoints: [path.join(root, 'apps/scare-meter/preload.ts')], outfile: path.join(out, 'preload.js'),
  platform: 'node', format: 'cjs', target: 'node20', external: ['electron', 'electron/*'] });
await esbuild.build({ ...common, entryPoints: [path.join(root, 'apps/probe/probe.ts')], outfile: path.join(out, 'probe.js'),
  platform: 'browser', format: 'iife', target: 'chrome120' });
fs.copyFileSync(path.join(root, 'apps/probe/index.html'), path.join(out, 'index.html'));
console.log('probe built');
