import { readFile, stat } from "node:fs/promises"
import { basename, join } from "node:path"

import { z } from "zod"

import type { MusicResult } from "./elevenlabs-music"
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

const ManifestSchema = z
  .object({
    version: z.literal(MUSIC_LIBRARY_VERSION),
    tracks: z
      .array(
        z
          .object({
            file: z.string().regex(/^[a-zA-Z0-9_-]+\.mp3$/),
            mood: z.enum(LIBRARY_MOODS as [MusicMood, ...MusicMood[]]),
            prompt: z.string().min(1),
            lengthMs: z.number().int().positive(),
          })
          .strict(),
      )
      .length(TARGET_LIBRARY_SIZE),
  })
  .strict()

const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_TRACK_BYTES = 12 * 1024 * 1024

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

export async function loadMusicLibraryTrack(input: {
  directory?: string
  mood: MusicMood
  sequence: number
}): Promise<MusicResult> {
  if (!input.directory) {
    return { ok: false, reason: "config_missing", retryable: false }
  }
  try {
    const manifestPath = join(input.directory, "manifest.json")
    const manifestStat = await stat(manifestPath)
    if (manifestStat.size > MAX_MANIFEST_BYTES) {
      return { ok: false, reason: "invalid_input", retryable: false }
    }
    const parsed = ManifestSchema.safeParse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    )
    if (!parsed.success) {
      return { ok: false, reason: "invalid_input", retryable: false }
    }
    const track = pickTrack(parsed.data, input.mood, input.sequence)
    if (!track || basename(track.file) !== track.file) {
      return { ok: false, reason: "invalid_input", retryable: false }
    }
    const trackPath = join(input.directory, track.file)
    const trackStat = await stat(trackPath)
    if (trackStat.size <= 0 || trackStat.size > MAX_TRACK_BYTES) {
      return { ok: false, reason: "invalid_input", retryable: false }
    }
    return {
      ok: true,
      audio: {
        format: "mp3",
        bytes: new Uint8Array(await readFile(trackPath)),
        prompt: track.prompt,
        lengthMs: track.lengthMs,
        model: `music_library_v${MUSIC_LIBRARY_VERSION}`,
      },
    }
  } catch {
    return { ok: false, reason: "config_missing", retryable: false }
  }
}
