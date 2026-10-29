import { describe, expect, it } from "vitest"

import {
  HOUSE_RULES,
  reviewMarkdown,
  reviewPrompt,
  revisionPrompt,
  runCreativeReview,
  stripDashes,
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

describe("stripDashes", () => {
  it("turns em and en dashes into commas and keeps hyphens", () => {
    expect(stripDashes("one — two – three-four")).toBe("one, two, three-four")
  })
})
