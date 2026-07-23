import { describe, expect, it, vi } from "vitest"

import {
  buildNarrationSegments,
  produceDevotionalAudio,
} from "./devotional-audio"
import type { GeneratedDevotional } from "./generate-devotional"

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

const okVoice = (text: string) => ({
  ok: true as const,
  audio: {
    format: "mp3" as const,
    bytes: new Uint8Array([1, 2, 3]),
    voiceId: "HKFOb9iktHA85uKXydRT",
    model: "eleven_multilingual_v2",
    characterCount: text.length,
  },
})
const okMusic = () => ({
  ok: true as const,
  audio: {
    format: "mp3" as const,
    bytes: new Uint8Array([4, 5]),
    prompt: "calm",
    lengthMs: 30000,
    model: "music_v1",
  },
})

describe("buildNarrationSegments", () => {
  it("orders cover → scripture → reflection-N… → conclusion → questions (no video segment)", () => {
    const ids = buildNarrationSegments(DEVO).map((s) => s.id)
    expect(ids[0]).toBe("cover")
    expect(ids[1]).toBe("scripture")
    expect(ids).not.toContain("video") // "Let's watch" rides on the scripture card
    expect(ids).toContain("conclusion")
    // question + invitation-to-pray share one 'questions' segment at the end
    expect(ids.at(-1)).toBe("questions")
    // reflection split into one or more reflection-N cards
    expect(
      ids.filter((i) => /^reflection-\d+$/.test(i)).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it("splits a long reflection into multiple narrated chunks", () => {
    const long = {
      ...DEVO,
      reflection: {
        ...DEVO.reflection,
        text:
          "First point about trust. Second thought about fear and faith. " +
          "A third reflection on the calm that follows. And a fourth on his presence with us. " +
          "Finally a fifth line drawing it together for today.",
      },
    }
    const refl = buildNarrationSegments(long).filter((s) =>
      /^reflection-\d+$/.test(s.id),
    )
    expect(refl.length).toBeGreaterThan(1)
  })

  it("opens the cover with the spoken weekday + date (no doubled 'today')", () => {
    const s = buildNarrationSegments(DEVO).find((x) => x.id === "cover")
    // DEVO.date is 2026-07-10 → Friday → "It's Friday, July 10. And today's…"
    expect(s?.text).toMatch(/^It's Friday, July 10\. And today's devotional: /)
    // "today" appears exactly once (in "today's devotional").
    expect(s?.text?.match(/today/gi)?.length).toBe(1)
  })

  it("includes the scripture connector and reference", () => {
    const s = buildNarrationSegments(DEVO).find((x) => x.id === "scripture")
    expect(s?.text).toMatch(/^Here's today's scripture\. Luke 8:24\. /)
    expect(s?.text).toMatch(/Let's watch\.$/) // leads into the video card
  })
})

describe("produceDevotionalAudio", () => {
  it("narrates every segment in the devotional's voice and makes the mood bed", async () => {
    const voiceover = vi
      .fn()
      .mockImplementation(async ({ text }) => okVoice(text))
    const music = vi.fn().mockResolvedValue(okMusic())
    const out = await produceDevotionalAudio(DEVO, {
      voiceover: voiceover as never,
      music: music as never,
    })
    expect(out.voice).toBe("male-d")
    // cover, scripture (+"Let's watch"), one reflection chunk, conclusion,
    // question+prayer.
    expect(out.segments.map((s) => s.id)).toEqual([
      "cover",
      "scripture",
      "reflection-1",
      "conclusion",
      "questions",
    ])
    expect(voiceover).toHaveBeenCalledTimes(5)
    expect(voiceover.mock.calls[0][0].voice).toBe("male-d")
    // cover uses the PLAIN (high-stability, no-style) delivery; the rest use the
    // emotive default (no explicit voiceSettings).
    expect(voiceover.mock.calls[0][0].voiceSettings?.stability).toBe(0.7)
    expect(voiceover.mock.calls[0][0].voiceSettings?.style).toBe(0)
    expect(voiceover.mock.calls[2][0].voiceSettings).toBeUndefined() // reflection-1
    expect(music.mock.calls[0][0].mood).toBe("peace")
    expect(out.music?.mood).toBe("peace")
    expect(out.skipped).toEqual([])
  })

  it("degrades to skipped (not throw) when the API key is missing", async () => {
    const missing = {
      ok: false as const,
      reason: "config_missing" as const,
      retryable: false,
    }
    const out = await produceDevotionalAudio(DEVO, {
      voiceover: vi.fn().mockResolvedValue(missing) as never,
      music: vi.fn().mockResolvedValue(missing) as never,
    })
    expect(out.segments).toHaveLength(0)
    expect(out.music).toBeNull()
    expect(out.skipped).toContain("music")
    expect(out.skipped).toContain("reflection-1")
  })
})
