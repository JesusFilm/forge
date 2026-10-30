import { describe, expect, it } from "vitest"

import {
  alignDecisions,
  HOUSE_RULES,
  removeDashes,
  reviewMarkdown,
  reviewPrompt,
  revisionTokenBudget,
  revisionPrompt,
  runCreativeReview,
  type CreativeReview,
} from "./creative-review"
import type { DevotionalLlm } from "./llm"

const review: CreativeReview = {
  verdict: "Strong hook, weak middle.",
  scores: [{ criterion: "Hook", score: 8, note: "Keep it." }],
  items: [
    {
      target: "card 3",
      problem: "No reason to swipe.",
      suggestion: "End on a question.",
      severity: "major",
    },
    {
      target: "card 2",
      problem: "Drop the Greek word.",
      suggestion: "Remove Χριστός.",
      severity: "minor",
    },
  ],
  mostImportant: "Fix card 3.",
}

/** A stub that records what it was asked and answers with `reply`. */
function stub(model: string, reply: unknown) {
  const calls: Array<{ system: string; user: string }> = []
  const llm: DevotionalLlm = {
    model,
    complete: async (input) => {
      calls.push({ system: input.system, user: input.user })
      return input.schema.parse(reply)
    },
  }
  return { llm, calls }
}

const draft = {
  kind: "carousel" as const,
  draft: "Card 1: Is Christ a last name?",
  lang: "en",
}

describe("creative review prompts", () => {
  it("gives the reviewer the house rules and the kind's rubric", () => {
    const { system, user } = reviewPrompt(draft)
    for (const rule of HOUSE_RULES) expect(system).toContain(rule)
    expect(user).toContain("reason to swipe")
    expect(user).toContain(draft.draft)
  })

  it("puts the owner's decisions in front of both models", () => {
    const locked = "Keep the Greek word on card 2."
    expect(reviewPrompt({ ...draft, locked }).system).toContain(locked)
    expect(revisionPrompt({ ...draft, locked }, review).system).toContain(
      locked,
    )
  })

  it("leaves the decisions block out when there are none", () => {
    expect(reviewPrompt(draft).system).not.toContain("already decided")
  })

  it("numbers the review items for the writer's decisions", () => {
    const { user } = revisionPrompt(draft, review)
    expect(user).toContain("1. [major] card 3")
    expect(user).toContain("2. [minor] card 2")
  })

  it("tells the writer how many decisions to return", () => {
    expect(revisionPrompt(draft, review).system).toContain(
      "return exactly 2 decisions",
    )
  })
})

describe("runCreativeReview", () => {
  it("reviews only when no writer is given", async () => {
    const reviewer = stub("openai/gpt-x", review)
    const result = await runCreativeReview(draft, { reviewer: reviewer.llm })
    expect(result.review.mostImportant).toBe("Fix card 3.")
    expect(result.revision).toBeUndefined()
    expect(reviewer.calls).toHaveLength(1)
  })

  it("hands the review to the writer and strips dashes from the revision", async () => {
    const reviewer = stub("openai/gpt-x", review)
    const writer = stub("anthropic/claude-x", {
      revised: "Card 3 — a question?",
      decisions: [
        { item: 1, accepted: true, why: "Adds a reason to swipe." },
        { item: 2, accepted: false, why: "The owner keeps the Greek word." },
      ],
    })
    const result = await runCreativeReview(draft, {
      reviewer: reviewer.llm,
      writer: writer.llm,
    })
    expect(writer.calls[0]!.user).toContain("Fix card 3.")
    expect(result.revision!.revised).toBe("Card 3, a question?")
    expect(result.writerModel).toBe("anthropic/claude-x")
  })
})

describe("reviewMarkdown", () => {
  it("marks taken and rejected suggestions with the writer's reason", () => {
    const md = reviewMarkdown(
      {
        review,
        reviewerModel: "openai/gpt-x",
        revision: {
          revised: "x",
          decisions: [
            { item: 1, accepted: true, why: "Adds a reason to swipe." },
            { item: 2, accepted: false, why: "The owner keeps it." },
          ],
        },
      },
      { kind: "carousel", lang: "en" },
    )
    expect(md).toContain("1. ✓ **card 3**")
    expect(md).toContain("2. ✗ **card 2**")
    expect(md).toContain("Decision: The owner keeps it.")
  })

  it("speaks Russian for a Russian draft", () => {
    const md = reviewMarkdown(
      { review, reviewerModel: "m" },
      { kind: "carousel", lang: "ru" },
    )
    expect(md).toContain("## Замечания")
  })
})

describe("removeDashes", () => {
  it("turns em and en dashes into commas and keeps hyphens", () => {
    expect(removeDashes("one — two – three-four")).toBe("one, two, three-four")
  })

  it("keeps a verse range a range", () => {
    expect(removeDashes("Luke 9:18–22 and 9:12 – 17")).toBe(
      "Luke 9:18-22 and 9:12-17",
    )
  })

  it("never joins lines: drops a dash that opens or ends a line", () => {
    expect(removeDashes("Card 1\n— Кто Я?\nAnd you —\nnext")).toBe(
      "Card 1\nКто Я?\nAnd you\nnext",
    )
  })
})

describe("revision safety", () => {
  const writerReply = {
    revised: "x",
    decisions: [
      { item: 2, accepted: false, why: "b" },
      { item: 1, accepted: true, why: "a" },
      { item: 1, accepted: false, why: "dup" },
      { item: 9, accepted: true, why: "out of range" },
    ],
  }

  it("keeps one in-range decision per item, in item order", () => {
    expect(alignDecisions(writerReply.decisions, 2)).toEqual([
      { item: 1, accepted: true, why: "a" },
      { item: 2, accepted: false, why: "b" },
    ])
  })

  it("says when the writer skipped a note", () => {
    const md = reviewMarkdown(
      {
        review,
        reviewerModel: "m",
        revision: { revised: "x", decisions: [writerReply.decisions[1]!] },
      },
      { kind: "carousel", lang: "en" },
    )
    expect(md).toContain("the writer did not answer this note")
  })

  it("keeps the review when the writer fails", async () => {
    const reviewer = stub("openai/gpt-x", review)
    const writer: DevotionalLlm = {
      model: "anthropic/claude-x",
      complete: async () => {
        throw new Error("text was not valid JSON (finish: length)")
      },
    }
    const result = await runCreativeReview(draft, {
      reviewer: reviewer.llm,
      writer,
    })
    expect(result.review.mostImportant).toBe("Fix card 3.")
    expect(result.revision).toBeUndefined()
    expect(result.revisionError).toContain("finish: length")
    expect(reviewMarkdown(result, draft)).toContain("review above still stands")
  })

  it("does not call the writer when the review has no notes", async () => {
    const reviewer = stub("openai/gpt-x", { ...review, items: [] })
    const writer = stub("anthropic/claude-x", writerReply)
    const result = await runCreativeReview(draft, {
      reviewer: reviewer.llm,
      writer: writer.llm,
    })
    expect(writer.calls).toHaveLength(0)
    expect(result.revision).toBeUndefined()
  })

  it("gives the writer room for the whole draft", () => {
    const long = { ...draft, draft: "я".repeat(30_000) }
    expect(revisionTokenBudget(long, review)).toBeGreaterThan(15_000)
    expect(revisionTokenBudget(draft, review)).toBeLessThan(3_000)
  })
})
