import { describe, expect, it, vi } from "vitest"

import { generateDevotional, stripDashes } from "./generate-devotional"
import type { DevotionalLlm } from "./llm"
import type { ReflectionCorpora } from "./reflection-corpus"

const llm: DevotionalLlm = { model: "fake", complete: vi.fn() }

// Stub corpora: Henry has Luke 8; Spurgeon has a peace/trust entry.
const corpora: ReflectionCorpora = {
  ryleMatthew: [],
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
  chapters: [
    {
      index: 19,
      id: "1_jf6119-0-0",
      title: "Jesus Calms the Storm",
      start: "0:45:44",
    },
  ],
  passages: [
    {
      index: 19,
      osisRef: "Luke.8.22-Luke.8.25",
      reference: "Luke 8:22-25",
      mood: "peace" as const,
      themes: ["peace", "trust"],
    },
  ],
  hookStyles: ["a bold statement"],
  voiceRotation: ["male-d", "male-e", "female-c"],
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
    conclusion: "The One who calms the sea is in your boat.",
    question: "What storm do you need to hand to Jesus today?",
    prayer: "Jesus, help me trust you.",
  }),
  pickSpurgeon: vi
    .fn()
    .mockImplementation(async ({ candidates }) => candidates[0] ?? null),
  pickHighlights: vi.fn().mockResolvedValue([]),
  // Keeps every point, so these fixtures exercise the unnarrowed path. The
  // narrowing itself is covered in reflection-point-picker.test.ts and by the
  // dedicated cases below.
  pickPoints: vi.fn().mockImplementation(async ({ points }) => ({
    chosen: points.map((p: { index: number }) => p.index),
    reason: "test keeps every point",
  })),
  writeConclusion: vi
    .fn()
    .mockResolvedValue({ conclusion: "Grace that finds you keeps you." }),
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

  // Owner rule: at most TWO of the author's points per devotional, enforced by
  // narrowing the source BEFORE the writer sees it rather than by asking the
  // writer to self-limit. Each case below fails if that wiring is removed.
  describe("point narrowing (owner rule: at most two points)", () => {
    const THREE_POINTS = [
      "These verses describe a storm on the lake.",
      "We learn, firstly, that Christ's disciples are not spared trouble.",
      "We learn, secondly, that he sleeps while they panic.",
      "We learn, thirdly, that a word from him is enough.",
    ].join(" ")
    const multiPoint = {
      ...deps,
      corpora: {
        ...corpora,
        matthewHenry: [
          {
            source: "Matthew Henry, Commentary on the Whole Bible",
            reference: "Luke 8",
            osisRef: "Luke.8",
            text: THREE_POINTS,
          },
        ],
      },
      // Keep points 1 and 3 so a passing result cannot come from "kept
      // everything" — point 2 must be absent for the assertions to hold.
      pickPoints: vi
        .fn()
        .mockResolvedValue({ chosen: [1, 3], reason: "fit the verse" }),
    }

    it("hands the writer only the chosen points, not the whole excerpt", async () => {
      await generateDevotional(
        { chapterIndex: 19, sequence: 0, date: "d", llm },
        multiPoint,
      )
      const handed = multiPoint.modernize.mock.calls.at(-1)?.[0].sourceText
      expect(handed).toContain("firstly")
      expect(handed).toContain("thirdly")
      expect(handed).not.toContain("secondly")
      // The preamble frames the scene, so it survives the narrowing.
      expect(handed).toContain("These verses describe a storm")
    })

    it("records the narrowed excerpt as provenance for the fidelity critic", async () => {
      const d = await generateDevotional(
        { chapterIndex: 19, sequence: 0, date: "d", llm },
        multiPoint,
      )
      // Without this field the fidelity critic has nothing to compare the
      // adaptation against and self-skips, i.e. the gate goes quietly dormant.
      expect(d.reflection.sourceExcerpt).toContain("thirdly")
      expect(d.reflection.sourceExcerpt).not.toContain("secondly")
    })

    it("reports which points were kept, so the choice is not silent", async () => {
      const log = vi.fn()
      await generateDevotional(
        { chapterIndex: 19, sequence: 0, date: "d", llm, log },
        multiPoint,
      )
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("reflection points 1+3 of 3"),
      )
      expect(log).toHaveBeenCalledWith(expect.stringContaining("fit the verse"))
    })

    it("passes an excerpt with no ordinal structure through whole", async () => {
      // Roughly a fifth of the corpus is continuous exposition. Narrowing must
      // not fire there, and the picker must not be paid for nothing.
      await generateDevotional(
        { chapterIndex: 19, sequence: 0, date: "d", llm },
        deps,
      )
      expect(deps.pickPoints).not.toHaveBeenCalled()
      expect(deps.modernize.mock.calls.at(-1)?.[0].sourceText).toBe(
        "Henry on Luke 8 (the storm).",
      )
    })
  })

  describe("closing line", () => {
    it("comes from the dedicated conclusion agent, not the copywriter", async () => {
      const d = await generateDevotional(
        { chapterIndex: 19, sequence: 0, date: "d", llm },
        deps,
      )
      expect(d.conclusion).toBe("Grace that finds you keeps you.")
      // The copywriter still returns a conclusion of its own; using it would be
      // a silent downgrade, so pin that it is NOT what ships.
      expect(d.conclusion).not.toBe(
        "The One who calms the sea is in your boat.",
      )
    })

    it("sees the copywriter's chosen fields, so it stays complementary", async () => {
      await generateDevotional(
        { chapterIndex: 19, sequence: 0, date: "d", llm },
        deps,
      )
      // Ordering rule: conclusion runs AFTER copy. If it ran before, these
      // would be undefined.
      expect(deps.writeConclusion).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Peace in the Storm",
          question: "What storm do you need to hand to Jesus today?",
          prayer: "Jesus, help me trust you.",
          reflection: "Modernized reflection text.",
        }),
      )
    })
  })

  it("rotates: even seq → Henry commentary + Voice D; odd → Spurgeon + Voice E", async () => {
    const even = await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "d", llm },
      deps,
    )
    expect(even.reflection.flavor).toBe("commentary")
    expect(even.reflection.source).toContain("Matthew Henry")
    expect(even.voice).toBe("male-d")

    const odd = await generateDevotional(
      { chapterIndex: 19, sequence: 1, date: "d", llm },
      deps,
    )
    expect(odd.reflection.flavor).toBe("spurgeon")
    expect(odd.reflection.source).toContain("Spurgeon")
    expect(odd.voice).toBe("male-e")
  })

  it("falls back to commentary when the Spurgeon ranker finds no genuine fit", async () => {
    const noFit = { ...deps, pickSpurgeon: vi.fn().mockResolvedValue(null) }
    const d = await generateDevotional(
      { chapterIndex: 19, sequence: 1, date: "d", llm }, // seq 1 → prefers Spurgeon
      noFit,
    )
    expect(d.reflection.flavor).toBe("commentary")
    expect(d.reflection.source).toContain("Matthew Henry")
    expect(d.voice).toBe("male-e") // voice still rotates by sequence
  })

  it("throws for a chapter with no passage mapping", async () => {
    await expect(
      generateDevotional(
        { chapterIndex: 62, sequence: 0, date: "d", llm },
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
