import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { saveCachedAudio } from "./devotional-cache"
import {
  produceDevotionalAudio,
  type ProducedDevotionalAudio,
} from "./devotional-audio"
import type { GeneratedDevotional } from "./generate-devotional"

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

/**
 * The guard above reads a flag that `produceDevotionalAudio` has to carry all
 * the way through. It did not: a segment of more than one sentence is joined
 * into a brand-new audio object, and that object was built field by field
 * without `synthetic`. Units are split per sentence, so nearly every real
 * segment is multi-unit — the guard only ever fired on the rare single-
 * sentence card, and a silent preview could still reach the cache.
 *
 * The bundle fixtures above cannot catch this: they are hand-built with one
 * segment, which is exactly the shape that happened to work.
 */
const DEVO: GeneratedDevotional = {
  date: "2026-07-10",
  clip: { index: 19, id: "1_jf6119-0-0", title: "Jesus Calms the Storm" },
  passage: { reference: "Luke 8:22-25", osisRef: "Luke.8.22-Luke.8.25" },
  title: "Peace in the Storm",
  scripture: {
    reference: "Luke 8:24",
    text: "He rebuked the wind and the raging water; and it was calm.",
    translation: "WEB",
    needsCanonicalSource: true,
  },
  reflection: {
    text: "Christ stilled the storm with a word.",
    source: "Matthew Henry, Commentary on the Whole Bible",
    attribution: "Adapted from Matthew Henry, Commentary on the Whole Bible",
    flavor: "commentary",
  },
  reflectionHighlights: [],
  conclusion: "The One who calms the sea is in your boat.",
  question: "What storm do you need to hand to Jesus today?",
  prayer: "Jesus, calm my storm.",
  mood: "peace",
  voice: "male-d",
  sequence: 0,
}

describe("produceDevotionalAudio + saveCachedAudio", () => {
  it("keeps a joined multi-sentence segment marked synthetic, so the cache still refuses it", async () => {
    const silent = async ({ text }: { text: string }) => ({
      ok: true as const,
      audio: {
        format: "mp3" as const,
        bytes: new Uint8Array([0, 0, 0]),
        voiceId: "silent-preview",
        model: "silent-preview",
        characterCount: text.length,
        synthetic: true,
      },
    })
    const out = await produceDevotionalAudio(
      {
        ...DEVO,
        // Two sentences → two units → the join branch, which is the one that
        // dropped the flag.
        question: "What storm is yours today?",
        prayer: "Jesus, calm my storm.",
      },
      {
        voiceover: silent as never,
        music: (async () => ({ ok: false as const })) as never,
        libraryBed: async () => null,
        joinVarGaps: async (parts: ReadonlyArray<Uint8Array>) =>
          new Uint8Array(parts.flatMap((p) => Array.from(p))),
      } as never,
    )
    const questions = out.segments.find((s) => s.id === "questions")
    expect(questions).toBeDefined()
    expect(questions!.audio.synthetic).toBe(true)

    const dir = await mkdtemp(path.join(tmpdir(), "devo-cache-"))
    await expect(saveCachedAudio(dir, out)).rejects.toThrow(
      /synthetic narration/,
    )
  })
})
