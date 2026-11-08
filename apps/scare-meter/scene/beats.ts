/**
 * apps/scare-meter/scene/beats.ts
 *
 * The Scare Meter scene script: "The Night Visitor", 90 seconds.
 *
 * Beats are the stretches the report scores (design §8). Cues are the exact
 * moments a sound or visual event fires inside a beat. Both are plain data so
 * the player, the report and the tests share one source of truth.
 */

import type { Beat } from 'kit/vitals';

/** Total scene length in milliseconds. */
export const SCENE_DURATION_MS = 90_000;

/**
 * The scene arc. Beats are contiguous and cover the whole scene, so every
 * moment of the scene belongs to exactly one beat.
 */
export const BEATS: readonly Beat[] = [
  { id: 'calm',    startMs: 0,      durationMs: 15_000, label: 'the quiet room' },
  { id: 'creak',   startMs: 15_000, durationMs: 10_000, label: 'the creak' },
  { id: 'knock',   startMs: 25_000, durationMs: 7_000,  label: 'the knock' },
  { id: 'shadow',  startMs: 32_000, durationMs: 20_000, label: 'the shadow' },
  { id: 'face',    startMs: 52_000, durationMs: 8_000,  label: 'the face in the window' },
  { id: 'silence', startMs: 60_000, durationMs: 20_000, label: 'the long silence' },
  { id: 'slam',    startMs: 80_000, durationMs: 10_000, label: 'the slam' },
];

/** Kinds of one-shot events the player triggers. */
export type CueKind = 'creak' | 'knock' | 'drone' | 'shriek' | 'flicker' | 'slam' | 'droneOff';

/** A one-shot event at an exact scene time. */
export interface Cue {
  atMs: number;
  kind: CueKind;
}

/** Every one-shot event in the scene, in time order. */
export const CUES: readonly Cue[] = [
  { atMs: 16_000, kind: 'creak' },
  { atMs: 21_500, kind: 'creak' },
  { atMs: 26_000, kind: 'knock' },
  { atMs: 26_650, kind: 'knock' },
  { atMs: 27_300, kind: 'knock' },
  { atMs: 32_500, kind: 'drone' },
  { atMs: 52_000, kind: 'shriek' },
  { atMs: 52_200, kind: 'droneOff' },
  { atMs: 80_000, kind: 'flicker' },
  { atMs: 84_000, kind: 'slam' },
];

/** Time of the door slam; the visuals use it too. */
export const SLAM_AT_MS = 84_000;

/**
 * Return the id of the beat playing at `sceneMs`, or null outside the scene.
 *
 * @param beats    Contiguous or gapped beat list, in any order.
 * @param sceneMs  Milliseconds since the scene started.
 */
export function beatAt(beats: readonly Beat[], sceneMs: number): string | null {
  for (const b of beats) {
    if (sceneMs >= b.startMs && sceneMs < b.startMs + b.durationMs) {
      return b.id;
    }
  }
  return null;
}

/**
 * Return the cues whose time falls in (fromMs, toMs]. The player calls this
 * once per animation frame with the previous and current scene time, so each
 * cue fires exactly once even when frames are uneven.
 */
export function cuesBetween(cues: readonly Cue[], fromMs: number, toMs: number): Cue[] {
  return cues.filter((c) => c.atMs > fromMs && c.atMs <= toMs);
}
