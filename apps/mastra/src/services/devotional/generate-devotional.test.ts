import { describe, expect, it, vi } from "vitest"

import {
  composeDevotionalContent,
  generateDevotional,
  stripDashes,
} from "./generate-devotional"
import type { ChapterWithPassage } from "./jesus-film-passages"
import type { DevotionalLlm } from "./llm"
import type { ReflectionCorpora } from "./reflection-corpus"

const llm: DevotionalLlm = { model: "fake", complete: vi.fn() }

// Stub corpora: Ryle (Luke's primary commentary — owner preference, the
// JESUS film is Luke-only) covers the storm; Spurgeon has a peace/trust entry.
const corpora: ReflectionCorpora = {
  ryleMatthew: [],
  ryleLuke: [
    {
      source: "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
      reference: "Jesus Calms the Storm, Luke 8:22-25",
      osisRef: "Luke.8.22-Luke.8.25",
      text: "Ryle on Luke 8 (the storm).",
    },
  ],
  matthewHenry: [
    {
      source: "Matthew Henry, Commentary on the Whole Bible",
      reference: "Luke 8",
      osisRef: "Luke.8",
      text: "Henry on Luke 8 (the storm).",
    },
  ],
  spurgeon: [
    {
      source: "Charles Spurgeon, Morning and Evening",
      reference: "Isaiah 26:3",
      osisRef: "Isa.26.3",
      verse: "You keep him in perfect peace whose mind is stayed on you.",
      text: "Peace and trust in the storms of life.",
    },
  ],
}

const deps = {
  corpora,
  selectScripture: vi.fn().mockResolvedValue({
    reference: "Luke 8:25",
    text: "Where is your faith?",
    translation: "WEB",
    needsCanonicalSource: true,
  }),
  modernize: vi.fn().mockImplementation(async ({ sourceName }) => ({
    adapted: "Modernized reflection text.",
    attribution: `Adapted from ${sourceName}`,
    focusReference: "Luke 8:22-25",
  })),
  writeCopy: vi.fn().mockResolvedValue({
    title: "Peace in the Storm",
    question: "What storm do you need to hand to Jesus today?",
    prayer: "Jesus, help me trust you.",
  }),
  writeConclusion: vi.fn().mockResolvedValue({
    conclusion: "The One who calms the sea is in your boat.",
  }),
  pickSpurgeon: vi
    .fn()
    .mockImplementation(async ({ candidates }) => candidates[0] ?? null),
  pickHighlights: vi.fn().mockResolvedValue([]),
  // Best-effort by contract (see subtitle-align.ts's fetchClipTranscript) —
  // stubbed to "no transcript available" so these tests stay hermetic and
  // exercise the same fallback every real subtitle-fetch failure takes.
  fetchTranscript: vi.fn().mockResolvedValue(undefined),
}

describe("generateDevotional", () => {
  it("assembles a full devotional for chapter 19 (the storm)", async () => {
    const d = await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "2026-07-10", llm },
      deps,
    )
    expect(d.clip.title).toBe("Jesus Calms the Storm")
    expect(d.passage.osisRef).toBe("Luke.8.22-Luke.8.25")
    expect(d.title).toBe("Peace in the Storm")
    expect(d.scripture.translation).toBe("WEB")
    expect(d.reflection.text).toBe("Modernized reflection text.")
    expect(d.mood).toBe("peace")
    expect(d.question).toContain("storm")
  })

  it("voice rotates by sequence (D→E); reflection stays Ryle commentary — on-passage commentary always wins when available, Spurgeon is a fallback only", async () => {
    const even = await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "d", llm },
      deps,
    )
    expect(even.reflection.flavor).toBe("commentary")
    expect(even.reflection.source).toContain("Ryle")
    expect(even.voice).toBe("male-d")

    const odd = await generateDevotional(
      { chapterIndex: 19, sequence: 1, date: "d", llm },
      deps,
    )
    expect(odd.reflection.flavor).toBe("commentary")
    expect(odd.reflection.source).toContain("Ryle")
    expect(odd.voice).toBe("male-e")
  })

  it("falls back to Spurgeon only when there is no commentary for the passage", async () => {
    const noCommentary = {
      ...deps,
      corpora: { ...corpora, ryleMatthew: [], ryleLuke: [], matthewHenry: [] },
    }
    const d = await generateDevotional(
      { chapterIndex: 19, sequence: 1, date: "d", llm },
      noCommentary,
    )
    expect(d.reflection.flavor).toBe("spurgeon")
    expect(d.reflection.source).toContain("Spurgeon")
    expect(d.voice).toBe("male-e") // voice still rotates by sequence
  })

  it("throws when neither commentary nor a Spurgeon fit is available", async () => {
    const noFit = {
      ...deps,
      // Clear every source, including Spurgeon — `selectReflection`'s own
      // theme-scored fallback would otherwise still find the Isaiah entry
      // even with pickSpurgeon mocked to null (that mock only gates the
      // LLM-ranked shortlist path, not selectReflection's pure scoring).
      corpora: {
        ...corpora,
        ryleMatthew: [],
        ryleLuke: [],
        matthewHenry: [],
        spurgeon: [],
      },
      pickSpurgeon: vi.fn().mockResolvedValue(null),
    }
    await expect(
      generateDevotional(
        { chapterIndex: 19, sequence: 1, date: "d", llm },
        noFit,
      ),
    ).rejects.toThrow(/no reflection source/)
  })

  it("throws for a chapter with no passage mapping", async () => {
    await expect(
      generateDevotional(
        { chapterIndex: 2, sequence: 0, date: "d", llm },
        deps,
      ),
    ).rejects.toThrow(/no passage mapping/)
  })
})

describe("clip transcript", () => {
  it("fetches the transcript for the chapter's own curated window, in English", async () => {
    const fetchTranscript = vi.fn().mockResolvedValue(undefined)
    await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "d", llm },
      { ...deps, fetchTranscript },
    )
    expect(fetchTranscript).toHaveBeenCalledWith(
      expect.any(String), // chapter.id — an Arclight media id, not asserted verbatim here
      2, // ch19's clipStartSec
      106, // ch19's clipLengthSec
    )
  })

  it("threads a fetched transcript into the writer and onto the result", async () => {
    const fetchTranscript = vi.fn().mockResolvedValue("Peace, be still.")
    const d = await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "d", llm },
      { ...deps, fetchTranscript },
    )
    expect(d.clipTranscript).toBe("Peace, be still.")
    expect(deps.modernize).toHaveBeenCalledWith(
      expect.objectContaining({ clipTranscript: "Peace, be still." }),
    )
  })

  it("logs whether this run actually had a transcript to ground the writer/critic in", async () => {
    const log = vi.fn()
    await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "d", llm, log },
      {
        ...deps,
        fetchTranscript: vi.fn().mockResolvedValue("Peace, be still."),
      },
    )
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/clip transcript: \d+ chars/),
    )

    log.mockClear()
    await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "d", llm, log },
      { ...deps, fetchTranscript: vi.fn().mockResolvedValue(undefined) },
    )
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/clip transcript: unavailable/),
    )
  })

  it("leaves the result without a transcript when none is available, with no change to the writer's other inputs", async () => {
    // This is the fallback path every real subtitle-fetch failure takes —
    // must be behavior-identical to a devotional generated before this
    // feature existed.
    const d = await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "d", llm },
      deps, // shared deps' fetchTranscript already resolves undefined
    )
    expect(d.clipTranscript).toBeUndefined()
    const call = (deps.modernize as ReturnType<typeof vi.fn>).mock.calls.at(-1)
    expect(call?.[0]).not.toHaveProperty("clipTranscript")
  })

  it("does not fail generation when the transcript fetch itself rejects", async () => {
    // fetchClipTranscript's own contract is "never throws" (see
    // subtitle-align.ts), but generation degrades to "no transcript" even if
    // a dependency violates that, rather than trusting the contract by
    // convention alone.
    const fetchTranscript = vi.fn().mockRejectedValue(new Error("boom"))
    const d = await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "d", llm },
      { ...deps, fetchTranscript },
    )
    expect(d.clipTranscript).toBeUndefined()
  })

  it("threads clipTranscript into BOTH halves of a two-act reflection", async () => {
    // The two-act layout calls `modernize` once per commentary point instead
    // of once for the whole reflection — this is the branch the plan's own
    // test scenarios called out as needing separate coverage, since the
    // single-call assertions above don't exercise it.
    const twoActChapter: ChapterWithPassage = {
      index: 33,
      id: "1_jf6133-0-0",
      title: "Jesus and Zaccheus",
      osisRef: "Luke.19.1-Luke.19.10",
      reference: "Luke 19:1-10",
      mood: "hope",
      themes: ["grace", "seeking"],
      splitActs: true,
    }
    const modernize = vi.fn().mockImplementation(async ({ sourceName }) => ({
      adapted: "Half of the reflection.",
      attribution: `Adapted from ${sourceName}`,
      focusReference: "Luke 19:1-10",
    }))
    await composeDevotionalContent(
      {
        chapter: twoActChapter,
        scripture: {
          reference: "Luke 19:10",
          text: "For the Son of Man came to seek and save the lost.",
          translation: "WEB",
          needsCanonicalSource: true,
        },
        clipTranscript: "Zacchaeus climbed the sycamore tree to see Jesus.",
        sequence: 0,
        date: "d",
        llm,
      },
      {
        ...deps,
        corpora: {
          ...corpora,
          ryleLuke: [
            {
              source: "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
              reference: "Zacchaeus, Luke 19:1-10",
              osisRef: "Luke.19.1-Luke.19.10",
              text:
                "I. Zacchaeus sought Jesus, climbing a tree to see over the crowd. " +
                "II. Jesus sought Zacchaeus first, before Zacchaeus had done anything to deserve it. " +
                "III. The crowd grumbled, but grace does not wait for a man to earn it.",
            },
          ],
        },
        modernize,
        pickPoints: vi
          .fn()
          .mockResolvedValue({ chosen: [1, 2], reason: "test" }),
      },
    )
    expect(modernize).toHaveBeenCalledTimes(2)
    for (const call of modernize.mock.calls) {
      expect(call[0]).toMatchObject({
        clipTranscript: "Zacchaeus climbed the sycamore tree to see Jesus.",
      })
    }
  })
})

describe("stripDashes", () => {
  it("replaces em/en dashes with commas and tidies punctuation", () => {
    expect(
      stripDashes("hardest moments—when temptation presses in—remember this"),
    ).toBe("hardest moments, when temptation presses in, remember this")
    // en dash too
    expect(stripDashes("love earns forgiveness – it's the opposite")).toBe(
      "love earns forgiveness, it's the opposite",
    )
    // no doubled punctuation when a dash sits before a colon/period
    expect(stripDashes("this — : that")).not.toMatch(/,\s*:/)
    // leaves dash-free text untouched
    expect(stripDashes("plain sentence, no dashes.")).toBe(
      "plain sentence, no dashes.",
    )
    // no em/en dash survives
    expect(stripDashes("a—b–c")).not.toMatch(/[—–]/)
  })
})

describe("which point lands last", () => {
  // Four points, because the picker only runs on a genuinely multi-point
  // excerpt. The commentator numbers the bleak one FIRST; the picker is asked
  // to close on the point that lifts, so it returns them in the order it wants
  // them heard rather than the order the author wrote them.
  const fourPoints: ReflectionCorpora = {
    ...corpora,
    ryleLuke: [
      {
        source: "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
        reference: "Jesus Calms the Storm, Luke 8:22-25",
        osisRef: "Luke.8.22-Luke.8.25",
        text:
          "I. Fear shows how weak the strongest believer really is. " +
          "II. The sea obeys a word from its Maker. " +
          "III. Sleep in a storm is not indifference. " +
          "IV. Christ is never asleep to the danger his people are in.",
      },
    ],
  }

  it("hands the writer the points in the picker's order, not the author's", async () => {
    const modernize = vi.fn().mockImplementation(async ({ sourceName }) => ({
      adapted: "Modernized reflection text.",
      attribution: `Adapted from ${sourceName}`,
      focusReference: "Luke 8:22-25",
    }))
    await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "2026-07-10", llm },
      {
        ...deps,
        corpora: fourPoints,
        modernize,
        // Point IV lifts, so it is asked for LAST — the reverse of how the
        // author numbered the pair. Returning [1, 4] would prove nothing.
        pickPoints: vi
          .fn()
          .mockResolvedValue({ chosen: [4, 1], reason: "test" }),
      },
    )
    const source = modernize.mock.calls[0][0].sourceText as string
    const lifting = source.indexOf("never asleep to the danger")
    const bleak = source.indexOf("how weak the strongest")
    expect(lifting).toBeGreaterThanOrEqual(0)
    expect(bleak).toBeGreaterThanOrEqual(0)
    // Author order would put "how weak" first; the picker asked for the reverse.
    expect(lifting).toBeLessThan(bleak)
  })
})
