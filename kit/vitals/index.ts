/**
 * kit/vitals — SDK wrapper, VitalsSource interface, and reading decoder.
 * Re-exports types so the rest of the kit imports from 'kit/vitals'.
 */

// --------------------------------------------------------------------------
// Data types (plain interfaces — safe to import anywhere, including tests)
// --------------------------------------------------------------------------
export type {
  VitalsReading,
  Baseline,
  Beat,
  TaggedReading,
  BeatChange,
  BeatResult,
  ReportData,
  ConsentRecord,
} from './types';

// --------------------------------------------------------------------------
// VitalsSource interface
// --------------------------------------------------------------------------
export type { VitalsSource, VitalsSourceEvents } from './VitalsSource';

// --------------------------------------------------------------------------
// Reading decoder (T-19)
// --------------------------------------------------------------------------
export { decodeReading } from './decodeReading';

// --------------------------------------------------------------------------
// Renderer-side SDK wrapper (T-21/T-22)
// Note: only import RendererVitalsSource in renderer-process code; it
// depends on @smartspectra/node-sdk/renderer which requires the preload
// bridge to be set up.
// --------------------------------------------------------------------------
export { RendererVitalsSource } from './RendererVitalsSource';
