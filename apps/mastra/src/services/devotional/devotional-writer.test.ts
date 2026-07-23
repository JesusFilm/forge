import { describe, expect, it } from "vitest"

import {
  chooseBlockOrder,
  writeDevotional,
  _internal,
  type GroundingSearchFn,
} from "./devotional-writer"
import type { DevotionalLlm } from "./llm"
import type { Hook, ScriptureRef, VideoClip } from "./types"

const HOOK: Hook = {
  type: "question",
  title: "Where do you find peace?",
  summary: "An invitation to rest in Christ.",
  sourceUrl: null,
}

const SCRIPTURE: ScriptureRef = {
  reference: "John 14:27",
  text: "Peace I leave with you.",
  translation: "NIV",
  needsCanonicalSource: true,
}

const VIDEO: VideoClip = {
  videoId: "video-42",
  title: "Jesus calms the storm",
  url: "jesus-calms-the-storm",
  thumbnailUrl: null,
}

const PARTNERS = ["gotquestions.org", "desiringgod.org"]

function llmReturning(value: unknown): DevotionalLlm {
  return { model: "test-model", complete: async () => value as never }
}

const emptyGrounding: GroundingSearchFn = async () => []

describe("writeDevotional", () => {
  it("produces a reflection, questions, and a valid block order", async () => {
    const devotional = await writeDevotional({
      date: "2026-06-22",
      hook: HOOK,
      scripture: SCRIPTURE,
      video: VIDEO,
      videoMatch: "search",
      partnerDomains: PARTNERS,
      grounding: emptyGrounding,
      llm: llmReturning({
        reflection:
          "Peace is not the absence of storms but the presence of Christ.",
        questions: [
          "Where is your fear loudest?",
          "What would trusting Jesus look like today?",
        ],
      }),
    })

    expect(devotional.reflection).toContain("Peace")
    expect(devotional.questions).toHaveLength(2)
    expect([...devotional.blockOrder].sort()).toEqual(
      ["hook", "questions", "reflection", "scripture", "video"].sort(),
    )
  })

  it("keeps a furtherReading link only when it is on a partner domain", async () => {
    const partner = await writeDevotional({
      date: "2026-06-22",
      hook: HOOK,
      scripture: SCRIPTURE,
      video: VIDEO,
      videoMatch: "search",
      partnerDomains: PARTNERS,
      grounding: emptyGrounding,
      llm: llmReturning({
        reflection: "r",
        questions: ["q1", "q2"],
        furtherReading: "https://www.desiringgod.org/articles/peace",
      }),
    })
    expect(partner.furtherReading).toBe(
      "https://www.desiringgod.org/articles/peace",
    )

    const offlist = await writeDevotional({
      date: "2026-06-22",
      hook: HOOK,
      scripture: SCRIPTURE,
      video: VIDEO,
      videoMatch: "search",
      partnerDomains: PARTNERS,
      grounding: emptyGrounding,
      llm: llmReturning({
        reflection: "r",
        questions: ["q1", "q2"],
        furtherReading: "https://random-blog.example.com/peace",
      }),
    })
    expect(offlist.furtherReading).toBeNull()
  })

  it.each([
    "http://desiringgod.org/articles/peace",
    "javascript://desiringgod.org/%0Aalert(1)",
    "data://desiringgod.org/text/html,unsafe",
    "https://user:secret@desiringgod.org/articles/peace",
  ])("rejects unsafe partner URL %s", async (furtherReading) => {
    const devotional = await writeDevotional({
      date: "2026-06-22",
      hook: HOOK,
      scripture: SCRIPTURE,
      video: VIDEO,
      videoMatch: "search",
      partnerDomains: PARTNERS,
      grounding: emptyGrounding,
      llm: llmReturning({
        reflection: "r",
        questions: ["q1", "q2"],
        furtherReading,
      }),
    })

    expect(devotional.furtherReading).toBeNull()
  })

  it("still writes when partner grounding search fails (best-effort)", async () => {
    const devotional = await writeDevotional({
      date: "2026-06-22",
      hook: HOOK,
      scripture: SCRIPTURE,
      video: null,
      videoMatch: "none",
      partnerDomains: PARTNERS,
      grounding: async () => {
        throw new Error("firecrawl down")
      },
      llm: llmReturning({ reflection: "r", questions: ["q1", "q2"] }),
    })

    expect(devotional.reflection).toBe("r")
    // No video present, so block order omits "video".
    expect(devotional.blockOrder).not.toContain("video")
    expect([...devotional.blockOrder].sort()).toEqual(
      ["hook", "questions", "reflection", "scripture"].sort(),
    )
  })

  it("instructs the writer to produce original (non-verbatim) prose", () => {
    expect(_internal.WRITER_SYSTEM_PROMPT).toMatch(/original/i)
    expect(_internal.WRITER_SYSTEM_PROMPT).toMatch(/verbatim|do not copy/i)
  })

  describe("chooseBlockOrder", () => {
    const present = _internal.presentBlocks(VIDEO)

    it("is always a valid permutation of the present ingredients", () => {
      for (const date of ["2026-06-22", "2026-06-23", "2026-12-25"]) {
        const order = chooseBlockOrder(date, present)
        expect([...order].sort()).toEqual([...present].sort())
        expect(new Set(order).size).toBe(order.length)
      }
    })

    it("varies the arrangement across dates", () => {
      const dates = Array.from({ length: 12 }, (_, i) => `2026-06-${10 + i}`)
      const arrangements = new Set(
        dates.map((date) => chooseBlockOrder(date, present).join(">")),
      )
      expect(arrangements.size).toBeGreaterThan(1)
    })
  })
})
