import { describe, expect, it } from "vitest"

import type { DevotionalLlm } from "../../services/devotional/llm"
import {
  CreativeReviewInputSchema,
  handleCreativeReviewRouteRequest,
  runCreativeReviewWorkflow,
} from "./creative-review"

const review = {
  verdict: "Fine.",
  scores: [{ criterion: "Hook", score: 7, note: "ok" }],
  items: [],
  mostImportant: "Nothing big.",
}

const llm =
  (reply: unknown) =>
  (model: string): DevotionalLlm => ({
    model,
    complete: async (input) => input.schema.parse(reply),
  })

describe("creative-review workflow", () => {
  it("defaults to a carousel reviewed by GPT and revised by Claude", () => {
    const input = CreativeReviewInputSchema.parse({ draft: "Card 1" })
    expect(input.kind).toBe("carousel")
    expect(input.revise).toBe(true)
    expect(input.reviewerModel).toMatch(/^openai\//)
    expect(input.writerModel).toMatch(/^anthropic\//)
  })

  it("returns the review as markdown without revising when asked", async () => {
    const input = CreativeReviewInputSchema.parse({
      draft: "Card 1",
      revise: false,
    })
    const out = await runCreativeReviewWorkflow(input, {
      runId: "r1",
      llm: llm(review),
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.revision).toBeUndefined()
      expect(out.markdown).toContain("Nothing big.")
    }
  })

  it("reports a provider failure instead of throwing", async () => {
    const input = CreativeReviewInputSchema.parse({ draft: "Card 1" })
    const out = await runCreativeReviewWorkflow(input, {
      runId: "r2",
      llm: (model) => ({
        model,
        complete: async () => {
          throw new Error("credit limit")
        },
      }),
    })
    expect(out).toMatchObject({ ok: false, reason: "provider_failed" })
  })
})

describe("POST /forge-creative-review", () => {
  it("needs the service bearer", async () => {
    const res = await handleCreativeReviewRouteRequest({
      authHeader: undefined,
      serviceKeys: ["k"],
      readJson: async () => ({ draft: "x" }),
    })
    expect(res.status).toBe(401)
  })

  it("rejects a body without a draft", async () => {
    const res = await handleCreativeReviewRouteRequest({
      authHeader: "Bearer k",
      serviceKeys: ["k"],
      readJson: async () => ({ kind: "carousel" }),
    })
    expect(res.status).toBe(400)
  })

  it("runs the review for a valid body", async () => {
    const res = await handleCreativeReviewRouteRequest({
      authHeader: "Bearer k",
      serviceKeys: ["k"],
      readJson: async () => ({ draft: "Card 1", revise: false }),
      launch: (input, { runId }) =>
        runCreativeReviewWorkflow(input, { runId, llm: llm(review) }),
    })
    expect(res.status).toBe(200)
  })
})
