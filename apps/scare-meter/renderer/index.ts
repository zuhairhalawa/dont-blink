/**
 * apps/scare-meter/renderer/index.ts
 *
 * esbuild entry point for the renderer bundle (dist/scare-meter/renderer.js).
 * Importing app.ts here runs the DOMContentLoaded listener that wires up the
 * view router, consent screen, calibration, and Stop button.
 *
 * Side-effect import — no exports needed from the bundle entry point.
 */
import './app';
