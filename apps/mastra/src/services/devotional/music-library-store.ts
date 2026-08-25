import { readFile } from "node:fs/promises"
import path from "node:path"

import { getDevotionalMusicDir } from "../../config/env"
import type { MusicMood } from "./elevenlabs-music"
import { pickTrack, type MusicLibraryManifest } from "./music-library"
import { repoRoot } from "./repo-root"

/**
 * Read the pre-generated music library from disk.
 *
 * The library exists so a music credit is NOT spent on every render: 20 tracks,
 * five per mood, generated once. `music-library.ts` has held the selection
 * logic all along, but nothing called it — `produceDevotionalAudio` went
 * straight to `generateMusic`, so every single render bought a fresh bed from
 * the paid API while the twenty paid tracks sat unused on disk. Owner spotted
 * it in the ElevenLabs analytics.
 *
 * WHY A MISSING LIBRARY IS FATAL. Falling back to generation is right when the
 * library is present but cannot serve THIS mood; it is wrong when the library
 * is not there at all. On a deploy that is the same failure that cost money the
 * first time: nothing errors, renders keep working, and every one of them buys
 * a bed. So the two cases are now separated — an unreadable library throws, an
 * unserved mood still returns null.
 */

const LIBRARY_DIR = "devo/assets/music"

/** The library's directory: the env override, else the in-repo copy. */
function libraryDir(): string {
  return getDevotionalMusicDir() ?? path.join(repoRoot(), LIBRARY_DIR)
}

export class MusicLibraryMissingError extends Error {
  readonly code = "music_library_missing"
  constructor(dir: string, cause: string) {
    super(
      `the paid music library is not readable at ${dir} (${cause}). ` +
        `Renders would silently generate a fresh bed each time and bill for it. ` +
        `Mount the library or set DEVOTIONAL_MUSIC_DIR.`,
    )
    this.name = "MusicLibraryMissingError"
  }
}

export type LibraryBed = { file: string; bytes: Buffer; mood: MusicMood }

/**
 * The library manifest. Throws when the library itself is absent or unusable,
 * because that is configuration, not a miss.
 */
export async function loadMusicManifest(): Promise<MusicLibraryManifest> {
  const dir = libraryDir()
  let raw: string
  try {
    raw = await readFile(path.join(dir, "manifest.json"), "utf8")
  } catch {
    throw new MusicLibraryMissingError(dir, "manifest.json is unreadable")
  }
  let parsed: Partial<MusicLibraryManifest>
  try {
    parsed = JSON.parse(raw) as Partial<MusicLibraryManifest>
  } catch {
    throw new MusicLibraryMissingError(dir, "manifest.json is not valid JSON")
  }
  if (!Array.isArray(parsed.tracks) || parsed.tracks.length === 0) {
    throw new MusicLibraryMissingError(dir, "manifest.json lists no tracks")
  }
  return { version: parsed.version ?? 1, tracks: parsed.tracks }
}

/**
 * A bed for this mood, or null when the library cannot serve one.
 *
 * Note that an UNMATCHED MOOD is not a miss: `pickTrack` falls back to the whole
 * library rather than returning nothing, on the reasoning that a paid bed of the
 * wrong mood beats buying a fresh one. So in practice null means the manifest
 * named a file that is not on disk, and the caller then generates — a
 * half-present library still degrades to the old behaviour rather than to
 * silence.
 *
 * An absent library is NOT this case and throws; see the note at the top.
 */
export async function libraryBed(
  mood: MusicMood,
  sequence: number,
): Promise<LibraryBed | null> {
  const manifest = await loadMusicManifest()
  const track = pickTrack(manifest, mood, sequence)
  if (!track) return null
  try {
    const file = path.join(libraryDir(), track.file)
    return { file: track.file, bytes: await readFile(file), mood: track.mood }
  } catch {
    return null
  }
}
