/**
 * kit/signal/index.ts
 *
 * Public API for the signal-processing layer.
 * All functions are pure — no side effects, no Electron dependency.
 */

export { smoothSeries } from './smooth';
export { computeBaseline } from './baseline';
export { computeChange, detectBeatChange } from './change';
export { holdLatest, createHoldLatestState } from './holdLatest';
export type { HoldLatestState } from './holdLatest';
