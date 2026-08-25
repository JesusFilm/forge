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

  it("opens on the hook, then the settle line, and never speaks the date", () => {
    const s = buildNarrationSegments(DEVO).find((x) => x.id === "cover")
    // The hook is what stops the scroll, so nothing may precede it.
    expect(s?.text?.startsWith(DEVO.title)).toBe(true)
    expect(s?.text).toMatch(/Let's [a-z]/)
    // DEVO.date is 2026-07-10 → Friday. Neither the weekday nor the numeric
    // date may be spoken: it would date a video meant to be watched any day.
    expect(s?.text).not.toMatch(/Friday|July|10/)
  })

  it("rotates the settle line by sequence, so a series does not repeat itself", () => {
    const spoken = [0, 1, 2, 3].map(
      (sequence) =>
        buildNarrationSegments({ ...DEVO, sequence }).find(
          (x) => x.id === "cover",
        )?.text ?? "",
    )
    const settles = spoken.map((t) => t.slice(DEVO.title.length).trim())
    // Three distinct lines, and the fourth wraps back to the first.
    expect(new Set(settles.slice(0, 3)).size).toBe(3)
    expect(settles[3]).toBe(settles[0])
  })

  it("speaks a configured occasion between the hook and the settle line", () => {
    const s = buildNarrationSegments({ ...DEVO, date: "2026-08-19" }).find(
      (x) => x.id === "cover",
    )
    expect(s?.text).toMatch(
      /Today is also World Humanitarian Day\. Let's [a-z]/,
    )
    expect(s?.text?.startsWith(DEVO.title)).toBe(true)
  })

  it("says nothing extra on a date with no configured occasion", () => {
    const s = buildNarrationSegments(DEVO).find((x) => x.id === "cover")
    expect(s?.text).not.toMatch(/Today is also/)
  })

  it("includes the scripture connector and reference", () => {
    const s = buildNarrationSegments(DEVO).find((x) => x.id === "scripture")
    expect(s?.text).toMatch(/^Here's where we're reading today\. Luke 8:24\. /)
    expect(s?.text).toMatch(/Let's watch\.$/) // leads into the video card
  })

  it("does not echo the cover's 'Scripture' or 'passage' one card later", () => {
    // The cover's settle line already says one of those words seconds earlier,
    // and hearing it twice in a row is what makes the opening sound templated.
    const s = buildNarrationSegments(DEVO).find((x) => x.id === "scripture")
    expect(s?.text).not.toMatch(/scripture|passage/i)
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
      // Empty library → the generation path these assertions describe. Injected
      // rather than left to disk, so the test does not depend on whether the
      // developer happens to have devo/assets/music populated.
      libraryBed: async () => null,
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
    // cover uses the engaged story-opening delivery (steadier than the emotive
    // default, a little style); reflection uses the emotive default (undefined);
    // conclusion + questions use the weighty, settled delivery.
    expect(voiceover.mock.calls[0][0].voiceSettings?.stability).toBe(0.45)
    expect(voiceover.mock.calls[0][0].voiceSettings?.style).toBe(0.3)
    expect(voiceover.mock.calls[2][0].voiceSettings).toBeUndefined() // reflection-1
    expect(voiceover.mock.calls[3][0].voiceSettings?.stability).toBe(0.78) // conclusion
    expect(voiceover.mock.calls[4][0].voiceSettings?.stability).toBe(0.78) // questions
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
      libraryBed: async () => null,
    })
    expect(out.segments).toHaveLength(0)
    expect(out.music).toBeNull()
    expect(out.skipped).toContain("music")
    expect(out.skipped).toContain("reflection-1")
  })
})

describe("music library reuse", () => {
  /**
   * The library exists so a music credit is not spent per render. It was built
   * and paid for, then never wired in: every render called the paid Music API
   * while twenty tracks sat on disk. Owner found it in the ElevenLabs
   * analytics, not in any log — so these tests pin the wiring in place.
   */
  const bed = {
    file: "hope-2.mp3",
    bytes: Buffer.from("library-bytes"),
    mood: "hope" as const,
  }

  it("uses a library track and does NOT call the paid generator", async () => {
    const music = vi.fn().mockResolvedValue(okMusic())
    const out = await produceDevotionalAudio(DEVO, {
      voiceover: vi
        .fn()
        .mockImplementation(async ({ text }) => okVoice(text)) as never,
      music: music as never,
      libraryBed: async () => bed,
    })
    expect(music).not.toHaveBeenCalled()
    expect(out.music?.mood).toBe("hope")
    expect(Buffer.from(out.music!.audio.bytes).toString()).toBe("library-bytes")
  })

  it("records which library file was used, so a render can be traced", async () => {
    const out = await produceDevotionalAudio(DEVO, {
      voiceover: vi
        .fn()
        .mockImplementation(async ({ text }) => okVoice(text)) as never,
      music: vi.fn().mockResolvedValue(okMusic()) as never,
      libraryBed: async () => bed,
    })
    expect(out.music?.audio.prompt).toBe("library:hope-2.mp3")
  })

  it("falls back to generating when the library cannot serve the mood", async () => {
    // A partially-populated library must degrade to the old behaviour, never
    // to a silent video.
    const music = vi.fn().mockResolvedValue(okMusic())
    const out = await produceDevotionalAudio(DEVO, {
      voiceover: vi
        .fn()
        .mockImplementation(async ({ text }) => okVoice(text)) as never,
      music: music as never,
      libraryBed: async () => null,
    })
    expect(music).toHaveBeenCalledTimes(1)
    expect(out.music).not.toBeNull()
  })
})
