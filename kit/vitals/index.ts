/**
 * kit/vitals: SmartSpectra SDK wrapper and the plain data types around it.
 * Only import PresageSensor in renderer code; it needs the SDK preload bridge.
 */
export type { VitalsReading, Baseline } from './types';
export { decodeReading, readingFromMetrics } from './decodeReading';
export { createBlinkTracker, usToMs } from './blinks';
export type { BlinkStatus, BlinkTracker } from './blinks';
export { classifySdkError } from './errorPolicy';
export type { ErrorAction } from './errorPolicy';
export { PresageSensor, hintFor } from './PresageSensor';
export type { PresageSensorEvents } from './PresageSensor';
