import { describe, expect, it, vi } from "vitest"

import { generateDevotional, stripDashes } from "./generate-devotional"
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
