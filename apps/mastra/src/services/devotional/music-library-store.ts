import { readFile } from "node:fs/promises"
import path from "node:path"

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
 */

const LIBRARY_DIR = "devo/assets/music"

export type LibraryBed = { file: string; bytes: Buffer; mood: MusicMood }

export async function loadMusicManifest(): Promise<MusicLibraryManifest | null> {
  try {
    const raw = await readFile(
      path.join(repoRoot(), LIBRARY_DIR, "manifest.json"),
      "utf8",
    )
    const parsed = JSON.parse(raw) as Partial<MusicLibraryManifest>
    if (!Array.isArray(parsed.tracks) || parsed.tracks.length === 0) return null
    return { version: parsed.version ?? 1, tracks: parsed.tracks }
  } catch {
    return null
  }
}

/**
 * A bed for this mood from the library, or null when the library can't serve
 * one — a missing manifest, an empty mood, or a file named in the manifest that
 * isn't on disk. Null means the caller should fall back to generating, so a
 * half-present library degrades to the old behaviour rather than to silence.
 */
export async function libraryBed(
  mood: MusicMood,
  sequence: number,
): Promise<LibraryBed | null> {
  const manifest = await loadMusicManifest()
  if (!manifest) return null
  const track = pickTrack(manifest, mood, sequence)
  if (!track) return null
  try {
    const file = path.join(repoRoot(), LIBRARY_DIR, track.file)
    return { file: track.file, bytes: await readFile(file), mood: track.mood }
  } catch {
    return null
  }
}
