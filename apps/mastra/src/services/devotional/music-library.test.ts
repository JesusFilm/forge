import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { MusicLibraryManifest } from "./music-library"
import {
  emptyMusicManifest,
  LIBRARY_MOODS,
  loadMusicLibraryTrack,
  pickTrack,
  TARGET_LIBRARY_SIZE,
} from "./music-library"

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
  )
})

const track = (
  file: string,
  mood: MusicLibraryManifest["tracks"][number]["mood"],
) => ({
  file,
  mood,
  prompt: `prompt for ${file}`,
  lengthMs: 30_000,
})

const MANIFEST: MusicLibraryManifest = {
  version: 1,
  tracks: [
    track("peace-1.mp3", "peace"),
    track("peace-2.mp3", "peace"),
    track("hope-1.mp3", "hope"),
    track("lament-1.mp3", "lament"),
  ],
}

describe("music-library", () => {
  it("targets 20 tracks", () => {
    expect(TARGET_LIBRARY_SIZE).toBe(20)
  })

  it("returns null for an empty library", () => {
    expect(pickTrack(emptyMusicManifest(), "peace")).toBeNull()
  })

  it("picks a track matching the requested mood", () => {
    expect(pickTrack(MANIFEST, "hope")?.file).toBe("hope-1.mp3")
    expect(pickTrack(MANIFEST, "lament")?.file).toBe("lament-1.mp3")
  })

  it("rotates through tracks of a mood by sequence", () => {
    expect(pickTrack(MANIFEST, "peace", 0)?.file).toBe("peace-1.mp3")
    expect(pickTrack(MANIFEST, "peace", 1)?.file).toBe("peace-2.mp3")
    expect(pickTrack(MANIFEST, "peace", 2)?.file).toBe("peace-1.mp3")
  })

  it("falls back to any track when the mood is absent", () => {
    const picked = pickTrack(MANIFEST, "awe")
    expect(picked).not.toBeNull()
    expect(MANIFEST.tracks).toContainEqual(picked)
  })

  it("loads the deterministic track from a validated 20-track library", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devotional-music-"))
    tempDirs.push(directory)
    const tracks = LIBRARY_MOODS.flatMap((mood) =>
      Array.from({ length: 5 }, (_, index) =>
        track(`${mood}-${index + 1}.mp3`, mood),
      ),
    )
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ version: 1, tracks }),
    )
    await Promise.all(
      tracks.map(({ file }) => writeFile(join(directory, file), file)),
    )

    const result = await loadMusicLibraryTrack({
      directory,
      mood: "peace",
      sequence: 1,
    })

    expect(result).toMatchObject({
      ok: true,
      audio: { prompt: "prompt for peace-2.mp3", model: "music_library_v1" },
    })
  })
})
