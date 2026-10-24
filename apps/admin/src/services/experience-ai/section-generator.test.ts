import { describe, expect, it } from "vitest"
import type { DraftVideoSection } from "@forge/experience-schema"
import { applySectionAllowlist } from "./section-generator"
import { _internals } from "./mastra-experience-section-client"
import type { VideoContextPack } from "./video-context-pack.service"

const PACK: VideoContextPack = {
  video: {
    videoId: "vid1",
    slug: "the-resurrection",
    title: "The Resurrection",
    description: "A story.",
    previewImageUrl: null,
    previewStreamUrl: "https://example.com/v.m3u8",
    label: "FEATURE_FILM",
  },
  studyQuestions: [{ text: "Why does the resurrection matter?", order: 1 }],
  citations: [
    {
      reference: "John 20:19-29",
      osisId: "John.20.19",
      chapterStart: 20,
      chapterEnd: null,
      verseStart: 19,
      verseEnd: 29,
    },
  ],
  scene: null,
  transcript: null,
  provenance: {
    studyQuestions: true,
    citations: true,
    scene: false,
    transcript: false,
    localeFallback: null,
  },
}

const groundedQuote = {
  reference: "John 20:19-29",
  osisId: "John.20.19",
  chapterStart: 20,
  verseStart: 19,
  verseEnd: 29,
}
const offPackQuote = {
  reference: "Genesis 1:1",
  osisId: "Gen.1.1",
  chapterStart: 1,
  verseStart: 1,
  verseEnd: 1,
}

describe("applySectionAllowlist", () => {
  it("keeps grounded scripture + FAQ and reports provenance", () => {
    const section: DraftVideoSection = {
      blocks: [
        { t: "videoHero", candidateRef: "v01", heading: "Watch" },
        {
          t: "relatedQuestions",
          questions: [
            {
              question: "Why does the resurrection matter to us today?",
              answer: "...",
            },
          ],
        },
        { t: "bibleQuotesCarousel", quotes: [groundedQuote] },
      ],
    }
    const out = applySectionAllowlist(section, PACK)
    expect(out.dropped).toEqual({ scriptureQuotes: 0, faqQuestions: 0 })
    expect(out.blocks).toHaveLength(3)
    expect(out.usedCitations).toHaveLength(1)
    expect(out.faqCount).toBe(1)
  })

  it("drops an off-pack scripture quote (matched by identity, not label)", () => {
    const section: DraftVideoSection = {
      blocks: [
        { t: "videoHero", candidateRef: "v01", heading: "Watch" },
        { t: "bibleQuotesCarousel", quotes: [groundedQuote, offPackQuote] },
      ],
    }
    const out = applySectionAllowlist(section, PACK)
    expect(out.dropped.scriptureQuotes).toBe(1)
    const carousel = out.blocks.find((b) => b.t === "bibleQuotesCarousel")
    expect(carousel?.t).toBe("bibleQuotesCarousel")
    if (carousel?.t === "bibleQuotesCarousel") {
      expect(carousel.quotes).toHaveLength(1)
      expect(carousel.quotes[0].osisId).toBe("John.20.19")
    }
  })

  it("omits a scripture block entirely when all its quotes are off-pack", () => {
    const section: DraftVideoSection = {
      blocks: [
        { t: "videoHero", candidateRef: "v01", heading: "Watch" },
        { t: "bibleQuotesCarousel", quotes: [offPackQuote] },
      ],
    }
    const out = applySectionAllowlist(section, PACK)
    expect(
      out.blocks.find((b) => b.t === "bibleQuotesCarousel"),
    ).toBeUndefined()
    expect(out.dropped.scriptureQuotes).toBe(1)
  })

  it("drops an FAQ question that does not map to any study question", () => {
    const section: DraftVideoSection = {
      blocks: [
        { t: "videoHero", candidateRef: "v01", heading: "Watch" },
        {
          t: "relatedQuestions",
          questions: [
            { question: "Why does the resurrection matter?", answer: "..." },
            { question: "What is your favorite color?", answer: "..." },
          ],
        },
      ],
    }
    const out = applySectionAllowlist(section, PACK)
    expect(out.dropped.faqQuestions).toBe(1)
    const faq = out.blocks.find((b) => b.t === "relatedQuestions")
    expect(faq?.t).toBe("relatedQuestions")
    if (faq?.t === "relatedQuestions") {
      expect(faq.questions).toHaveLength(1)
      expect(faq.questions[0].question).toMatch(/resurrection/i)
    }
  })

  it("passes video / text blocks through unchanged", () => {
    const section: DraftVideoSection = {
      blocks: [
        { t: "videoHero", candidateRef: "v01", heading: "Watch" },
        {
          t: "text",
          heading: "About",
          contentParagraphs: ["A grounded paragraph."],
        },
      ],
    }
    const out = applySectionAllowlist(section, PACK)
    expect(out.blocks).toHaveLength(2)
    expect(out.blocks[1].t).toBe("text")
  })
})

describe("section client parseSectionRouteResult", () => {
  it("validates an ok section response against the schema", () => {
    const parsed = _internals.parseSectionRouteResult({
      ok: true,
      draft: {
        blocks: [{ t: "videoHero", candidateRef: "v01", heading: "x" }],
      },
    })
    expect(parsed).toMatchObject({ ok: true })
  })

  it("passes through a route failure envelope", () => {
    const parsed = _internals.parseSectionRouteResult({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
    expect(parsed).toMatchObject({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
  })

  it("returns null for an unrecognized shape", () => {
    expect(_internals.parseSectionRouteResult({ foo: "bar" })).toBeNull()
  })
})

describe("section client resolveTimeoutMs", () => {
  it("passes a valid positive number through", () => {
    expect(_internals.resolveTimeoutMs(75_000)).toBe(75_000)
  })

  it("defaults when the value is undefined (skipValidation drops the env default)", () => {
    expect(_internals.resolveTimeoutMs(undefined)).toBe(75_000)
  })

  it("coerces a numeric string (raw process.env value)", () => {
    expect(_internals.resolveTimeoutMs("90000")).toBe(90_000)
  })

  it("defaults for non-numeric, zero, negative, or NaN inputs", () => {
    expect(_internals.resolveTimeoutMs("not-a-number")).toBe(75_000)
    expect(_internals.resolveTimeoutMs(0)).toBe(75_000)
    expect(_internals.resolveTimeoutMs(-1)).toBe(75_000)
    expect(_internals.resolveTimeoutMs(Number.NaN)).toBe(75_000)
    expect(_internals.resolveTimeoutMs(null)).toBe(75_000)
  })
})
