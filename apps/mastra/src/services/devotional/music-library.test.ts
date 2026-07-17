import { describe, expect, it } from "vitest"

import type { MusicLibraryManifest } from "./music-library"
import {
  emptyMusicManifest,
  pickTrack,
  TARGET_LIBRARY_SIZE,
} from "./music-library"

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
})
