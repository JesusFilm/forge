import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { saveCachedAudio } from "./devotional-cache"
import type { ProducedDevotionalAudio } from "./devotional-audio"

/**
 * A silent preview wrote its silence into the persistent audio cache, and the
 * next real run reused it: the reuse key is (role, text, voice), which a silent
 * run matches exactly. The log said "reused 16 cached segment(s)" and the
 * staged devotional was -91 dB from end to end.
 *
 * The guard is at the cache boundary because three callers write here.
 */
function bundle(synthetic: boolean): ProducedDevotionalAudio {
  return {
    segments: [
      {
        id: "cover",
        text: "hello",
        audio: {
          format: "mp3",
          bytes: new Uint8Array([1, 2, 3]),
          voiceId: synthetic ? "silent-preview" : "real-voice",
          model: synthetic ? "silent-preview" : "eleven_multilingual_v2",
          characterCount: 5,
          ...(synthetic ? { synthetic: true } : {}),
        },
      },
    ],
    reused: [],
    failures: [],
  } as unknown as ProducedDevotionalAudio
}

describe("saveCachedAudio", () => {
  it("refuses synthetic narration and names the offending segment", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "devo-cache-"))
    await expect(saveCachedAudio(dir, bundle(true))).rejects.toThrow(
      /synthetic narration.*cover/s,
    )
    await expect(readdir(path.join(dir, "audio"))).rejects.toThrow()
  })

  it("still writes real narration", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "devo-cache-"))
    await saveCachedAudio(dir, bundle(false))
    expect(await readdir(path.join(dir, "audio"))).toContain("cover.mp3")
  })
})
