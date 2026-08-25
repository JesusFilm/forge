import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const musicDir = vi.fn<() => string | undefined>()
vi.mock("../../config/env", () => ({
  getDevotionalMusicDir: () => musicDir(),
}))

const { libraryBed, loadMusicManifest, MusicLibraryMissingError } =
  await import("./music-library-store")

/** A library on disk with one track, for `mood`. */
async function libraryWith(mood: string, file = "bed.mp3"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "music-lib-"))
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({ version: 1, tracks: [{ file, mood }] }),
  )
  await writeFile(path.join(dir, file), Buffer.from([1, 2, 3]))
  return dir
}

describe("a library that is not there", () => {
  beforeEach(() => musicDir.mockReset())

  it("throws rather than quietly falling back to generating", async () => {
    // This is the failure that cost money once already: nothing errored, every
    // render just bought a fresh bed while the paid tracks sat unused. On a
    // deploy an unmounted volume looks exactly the same, so it must be loud.
    musicDir.mockReturnValue(path.join(tmpdir(), "no-such-music-dir-xyz"))
    await expect(loadMusicManifest()).rejects.toBeInstanceOf(
      MusicLibraryMissingError,
    )
  })

  it("names the directory and the env var in the message", async () => {
    const missing = path.join(tmpdir(), "no-such-music-dir-abc")
    musicDir.mockReturnValue(missing)
    await expect(loadMusicManifest()).rejects.toThrow(missing)
    await expect(loadMusicManifest()).rejects.toThrow("DEVOTIONAL_MUSIC_DIR")
  })

  it("throws when the manifest exists but lists no tracks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "music-lib-"))
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({ version: 1, tracks: [] }),
    )
    musicDir.mockReturnValue(dir)
    await expect(loadMusicManifest()).rejects.toBeInstanceOf(
      MusicLibraryMissingError,
    )
  })
})

describe("a library that is there but cannot serve this bed", () => {
  beforeEach(() => musicDir.mockReset())

  it("serves a paid bed of another mood rather than buying a matching one", async () => {
    // Deliberate, and worth locking: `pickTrack` widens to the whole library
    // when the requested mood has no track. A bed of the wrong mood is cheaper
    // than a fresh generation, which is the cost this library exists to avoid.
    musicDir.mockReturnValue(await libraryWith("peace"))
    const bed = await libraryBed("awe" as never, 0)
    expect(bed?.mood).toBe("peace")
  })

  it("returns null when the manifest names a file that is not on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "music-lib-"))
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        version: 1,
        tracks: [{ file: "gone.mp3", mood: "peace" }],
      }),
    )
    musicDir.mockReturnValue(dir)
    expect(await libraryBed("peace" as never, 0)).toBeNull()
  })

  it("serves the bed when it can", async () => {
    musicDir.mockReturnValue(await libraryWith("peace"))
    const bed = await libraryBed("peace" as never, 0)
    expect(bed?.file).toBe("bed.mp3")
    expect(bed?.bytes.length).toBe(3)
  })
})
