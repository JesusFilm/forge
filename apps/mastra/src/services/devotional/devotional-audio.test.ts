import { describe, expect, it, vi } from "vitest"

import {
  buildNarrationSegments,
  produceDevotionalAudio,
  voiceTake,
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

  it("keeps the lead-ins inline when steps are OFF", () => {
    // The flag changes WHERE a phrase is spoken, never whether it is. Without
    // this, turning steps off would silently drop four spoken lines.
    const s = buildNarrationSegments(DEVO).find((x) => x.id === "scripture")
    expect(s?.text).toMatch(/^Here's where we're reading today\. Luke 8:24\. /)
    expect(s?.text).toMatch(/Let's watch\.$/)
  })

  it("moves the lead-ins off the scripture card when steps are ON", () => {
    // "Let's watch." glued to the END of the verse left no room to play the
    // step animation before the voice named the step. That is why they moved.
    const s = buildNarrationSegments(DEVO, undefined, { steps: true }).find(
      (x) => x.id === "scripture",
    )
    expect(s?.text).not.toMatch(/Here's where we're reading/)
    expect(s?.text).not.toMatch(/Let's watch/)
  })

  it("emits the four step segments, each carrying its spoken lead-in", () => {
    const segs = buildNarrationSegments(DEVO, undefined, { steps: true })
    const byId = new Map(segs.map((x) => [x.id, x]))
    // ONE opening screen: the line, then the stage, in a single segment — and
    // no citation on either (owner). The stepper hands over the moment the
    // voice starts naming chapter and verse.
    expect(byId.get("step-read")?.text).toBe(
      "Let’s pause and let Scripture speak. Here's where we're reading today.",
    )
    // Only the LINE is on screen; the second sentence is spoken over the
    // light arriving on READ.
    expect(byId.get("step-read")?.display).toBe(
      "Let’s pause and let Scripture speak",
    )
    expect(byId.get("scripture")?.text).toMatch(/^Luke 8:24\. /)
    expect(byId.get("step-watch")?.text).toBe("Let's watch.")
    expect(byId.get("step-reflect")?.text).toBe("Reflect on this.")
    expect(byId.get("step-pray")?.text).toBe("Let's bring this to God.")
    // The later step cards show the stepper and nothing else; only the
    // opening one has a line on screen.
    for (const id of ["step-watch", "step-reflect", "step-pray"]) {
      expect(byId.get(id)?.display).toBe("")
    }
  })

  it("orders each step segment immediately BEFORE the card it introduces", () => {
    const ids = buildNarrationSegments(DEVO, undefined, { steps: true }).map(
      (x) => x.id,
    )
    expect(ids.indexOf("step-read")).toBe(ids.indexOf("scripture") - 1)
    expect(ids.indexOf("step-watch")).toBe(ids.indexOf("scripture") + 1)
    expect(ids.indexOf("step-reflect")).toBe(ids.indexOf("reflection-1") - 1)
    expect(ids.indexOf("step-pray")).toBe(ids.indexOf("questions") - 1)
  })

  it("opens the stepper with its own line, and takes it off the cover", () => {
    // The settle line and the stepper's opening line ask for the same thing —
    // slow down — so with the stepper on only one of them is spoken, and it is
    // the one that has the four stages on screen behind it.
    const withSteps = buildNarrationSegments(DEVO, undefined, { steps: true })
    const byId = new Map(withSteps.map((x) => [x.id, x]))
    expect(byId.get("step-read")?.text).toMatch(
      /^Let’s pause and let Scripture speak\./,
    )
    expect(byId.get("cover")?.text).not.toMatch(
      /slow down|sit with|take a moment/i,
    )
    // Steps off: the cover keeps its settle line.
    const without = new Map(buildNarrationSegments(DEVO).map((x) => [x.id, x]))
    expect(without.get("step-read")).toBeUndefined()
    expect(without.get("cover")?.text).toMatch(
      /slow down|sit with|take a moment/i,
    )
  })

  it("puts the opening screen between the cover and the scripture", () => {
    const ids = buildNarrationSegments(DEVO, undefined, { steps: true }).map(
      (x) => x.id,
    )
    expect(ids.indexOf("step-read")).toBe(ids.indexOf("cover") + 1)
    expect(ids.indexOf("step-read")).toBe(ids.indexOf("scripture") - 1)
    // It is ONE segment, not two: the line and the stage share a card.
    expect(ids.filter((i) => i === "step-intro")).toEqual([])
  })

  it("emits no step segments unless asked", () => {
    const ids = buildNarrationSegments(DEVO).map((x) => x.id)
    expect(ids.filter((i) => i.startsWith("step-"))).toEqual([])
  })

  it("says the citation ONCE, wherever the steps flag puts it", () => {
    // Steps on: the scripture card opens with it. Steps off: the inline READ
    // connector still carries it and the verse must not repeat it.
    const withSteps = buildNarrationSegments(DEVO, undefined, { steps: true })
    const without = buildNarrationSegments(DEVO)
    const count = (t: string) => (t.match(/Luke 8:24/g) ?? []).length
    expect(count(withSteps.find((x) => x.id === "scripture")!.text)).toBe(1)
    expect(count(withSteps.find((x) => x.id === "step-read")!.text)).toBe(0)
    expect(count(without.find((x) => x.id === "scripture")!.text)).toBe(1)
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
    expect(voiceover.mock.calls[0][0].voiceSettings?.stability).toBe(0.35)
    expect(voiceover.mock.calls[0][0].voiceSettings?.style).toBe(0.45)
    // Every English role now carries the owner-approved pace (2026-09-25).
    expect(voiceover.mock.calls[0][0].voiceSettings?.speed).toBe(1.1)
    expect(voiceover.mock.calls[3][0].voiceSettings?.speed).toBe(1.1)
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

  it("rotates the bed by CHAPTER, not just the sequence counter", async () => {
    // Every devotional we cut is sequence 0, so rotating on `sequence` alone
    // handed the library the same number every time and two different "hope"
    // episodes came out on the identical bed (owner heard Good Samaritan's
    // music again under Parable of the Lamp). The rotation key has to tell
    // two devotionals apart, and the chapter is what differs.
    const keys: number[] = []
    const spy = async (_mood: unknown, key: number) => {
      keys.push(key)
      return bed
    }
    const run = (clipIndex: number) =>
      produceDevotionalAudio(
        { ...DEVO, clip: { ...DEVO.clip, index: clipIndex }, sequence: 0 },
        {
          voiceover: vi
            .fn()
            .mockImplementation(async ({ text }) => okVoice(text)) as never,
          music: vi.fn().mockResolvedValue(okMusic()) as never,
          libraryBed: spy as never,
        },
      )
    await run(31) // Good Samaritan
    await run(18) // Parable of the Lamp
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
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

describe("buildNarrationSegments — authored paragraphs and voices", () => {
  const AUTHORED: GeneratedDevotional = {
    ...DEVO,
    reflection: {
      ...DEVO.reflection,
      text: "Her first line. Her second line. His history. Her close.",
      paragraphs: [
        { text: "Her first line. Her second line.", voice: "female-c" },
        {
          text: "His history.",
          voice: "male-e",
          mark: {
            label: "HISTORICAL NOTE FROM",
            source: "Society of Biblical Literature",
          },
        },
        { text: "Her close.", voice: "female-c" },
      ],
    },
    voices: { hook: "female-c", "step-pray": "male-e", questions: "male-e" },
  }
  const segs = buildNarrationSegments(AUTHORED, undefined, {
    structure: "clip-first",
    hookLine: "That is not fair",
  })
  const reflections = segs.filter((s) => /^reflection-\d+$/.test(s.id))

  it("reads every card in its own paragraph's voice, and no card spans two paragraphs", () => {
    // A paragraph still shows sentence by sentence, as every reflection does;
    // what must hold is that a voice change always falls BETWEEN cards.
    expect(reflections.map((s) => [s.display, s.voice])).toEqual([
      ["Her first line.", "female-c"],
      ["Her second line.", "female-c"],
      ["His history.", "male-e"],
      ["Her close.", "female-c"],
    ])
  })

  it("puts a source mark on the first card of the paragraph that uses it, and only there", () => {
    expect(reflections.map((s) => s.mark?.source ?? null)).toEqual([
      null,
      null,
      "Society of Biblical Literature",
      null,
    ])
  })

  it("voices the named roles and leaves the rest to the devotional's own voice", () => {
    const byId = Object.fromEntries(segs.map((s) => [s.id, s.voice]))
    expect(byId.hook).toBe("female-c")
    expect(byId["step-pray"]).toBe("male-e")
    expect(byId.questions).toBe("male-e")
    // Not named in `voices`: reads in `voice`, so it carries no override.
    expect(byId.conclusion).toBeUndefined()
  })
})

describe("buildNarrationSegments — clip-first structure", () => {
  it("runs film → reflect → reflection → takeaway → verse → pray → questions, with no cover", () => {
    const ids = buildNarrationSegments(DEVO, undefined, {
      structure: "clip-first",
    }).map((s) => s.id)
    expect(ids[0]).toBe("step-reflect")
    expect(ids).not.toContain("cover")
    expect(ids).not.toContain("step-read")
    expect(ids).not.toContain("step-watch")
    // The verse closes the reflection: after the takeaway, before the prayer.
    expect(ids.indexOf("scripture")).toBeGreaterThan(ids.indexOf("conclusion"))
    expect(ids.indexOf("scripture")).toBeLessThan(ids.indexOf("step-pray"))
    expect(ids.at(-1)).toBe("questions")
  })

  it("opens on the spoken hook when one is given, and says it verbatim", () => {
    const segs = buildNarrationSegments(DEVO, undefined, {
      structure: "clip-first",
      hookLine: "Have you ever wondered if God hears someone like you",
    })
    expect(segs[0]?.id).toBe("hook")
    // Punctuation is added, wording is not touched: the question is written
    // per devotional and the voice must ask exactly that.
    expect(segs[0]?.text).toBe(
      "Have you ever wondered if God hears someone like you.",
    )
    // It is drawn on screen as the piece's title, verbatim and unpunctuated
    // by us — the spoken copy is the one that gets a terminal stop.
    expect(segs[0]?.display).toBe(
      "Have you ever wondered if God hears someone like you",
    )
    // The rest of the running order is unchanged.
    expect(segs[1]?.id).toBe("step-reflect")
  })

  it("has no hook segment when no hook line is given", () => {
    const ids = buildNarrationSegments(DEVO, undefined, {
      structure: "clip-first",
    }).map((s) => s.id)
    expect(ids).not.toContain("hook")
  })

  it("keeps the spoken text of shared segments identical to the classic steps-on cut", () => {
    // So a devotional narrated in the classic structure re-renders in this
    // one with a single new line: the REFLECT lead-in.
    const classic = new Map(
      buildNarrationSegments(DEVO, undefined, { steps: true }).map((s) => [
        s.id,
        s.text,
      ]),
    )
    const clipFirst = buildNarrationSegments(DEVO, undefined, {
      structure: "clip-first",
    })
    for (const seg of clipFirst) {
      if (seg.id === "step-reflect") {
        expect(seg.text).toBe(
          "Let's look more closely at what this story means.",
        )
        continue
      }
      expect(seg.text).toBe(classic.get(seg.id))
    }
  })
})

describe("the running order reaches every narration call site", () => {
  it("no call to buildNarrationSegments omits `structure`", async () => {
    // Same trap as `steps` and `suppressOccasion`: the option was threaded to
    // the staleness check and the fingerprint but not to the producer, which
    // then built the CLASSIC list, found every segment cached, and the
    // clip-first cut shipped "Reflect on this." where "Let's reflect on this."
    // was wanted — with the log reporting a clean cache hit.
    const { readdir, readFile } = await import("node:fs/promises")
    const path = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const here = path.dirname(fileURLToPath(import.meta.url))
    const files = (await readdir(here)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )
    const offenders: string[] = []
    for (const f of files) {
      const src = await readFile(path.join(here, f), "utf8")
      for (const m of src.matchAll(
        /buildNarrationSegments\(([\s\S]*?)\n\s*\}\)/g,
      )) {
        const args = m[1]
        if (args.includes("d: GeneratedDevotional")) continue
        if (!args.includes("structure"))
          offenders.push(`${f}: ${m[0].slice(0, 80)}…`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("voiceTake", () => {
  it("tags female-d's reflection reading with its delivery take", () => {
    expect(voiceTake("reflection-3", "female-d")).toBe("f4")
  })
  it("keeps the calm ending and other voices on the default delivery", () => {
    for (const id of ["cover", "conclusion", "questions"])
      expect(voiceTake(id, "female-d")).toBe("")
    expect(voiceTake("reflection-3", "male-e")).toBe("")
  })
  it("reads scripture calmly, under its own tag, in a voice with a fast take", () => {
    expect(voiceTake("scripture", "female-d")).toBe("calm")
    expect(voiceTake("scripture", "male-e")).toBe("")
  })
})
