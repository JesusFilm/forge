import type { MusicMood } from "./elevenlabs-music"

/**
 * The pre-generated ambient music library.
 *
 * Decision: rather than generate a fresh bed per devotional (a music credit
 * every run), we generate a small library ONCE (~20 tracks across a few moods)
 * and reuse the mood-matching track. This module is the read/select side; the
 * library is produced by `scripts/generate-music-library.mjs` which writes a
 * `manifest.json` next to the mp3s.
 *
 * Pure selection here (no IO) so it is easy to test and so the pipeline can pick
 * a track deterministically from a manifest loaded elsewhere.
 */

export const MUSIC_LIBRARY_VERSION = 1

/** Intended library shape: this many tracks per mood → 20 total. */
export const TRACKS_PER_MOOD = 5
export const LIBRARY_MOODS: readonly MusicMood[] = [
  "peace",
  "hope",
  "lament",
  "awe",
]
export const TARGET_LIBRARY_SIZE = TRACKS_PER_MOOD * LIBRARY_MOODS.length // 20

export type MusicTrack = {
  /** Library-relative file name, e.g. "peace-1.mp3". */
  file: string
  mood: MusicMood
  /** The prompt the track was generated from (provenance). */
  prompt: string
  lengthMs: number
}

export type MusicLibraryManifest = {
  version: number
  tracks: MusicTrack[]
}

export function emptyMusicManifest(): MusicLibraryManifest {
  return { version: MUSIC_LIBRARY_VERSION, tracks: [] }
}

/**
 * Pick a track for a mood. Rotates deterministically through the tracks of that
 * mood by `sequence` (so consecutive devotionals of the same mood don't reuse
 * the identical bed). Falls back to ANY track when the mood is absent, and
 * returns null only when the library is empty.
 */
export function pickTrack(
  manifest: MusicLibraryManifest,
  mood: MusicMood,
  sequence = 0,
): MusicTrack | null {
  if (manifest.tracks.length === 0) return null
  const ofMood = manifest.tracks.filter((t) => t.mood === mood)
  const pool = ofMood.length > 0 ? ofMood : manifest.tracks
  const n = pool.length
  const i = ((Math.trunc(sequence) % n) + n) % n
  return pool[i]
}
