import { describe, expect, it } from "vitest"

import {
  DevotionalLlmError,
  type DevotionalLlm,
} from "../../services/devotional/llm"
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

  it("reports a missing OpenRouter key as config_missing", async () => {
    const input = CreativeReviewInputSchema.parse({ draft: "Card 1" })
    const out = await runCreativeReviewWorkflow(input, {
      runId: "r3",
      llm: () => {
        throw new DevotionalLlmError("missing_credentials", "no key")
      },
    })
    expect(out).toMatchObject({ ok: false, reason: "config_missing" })
  })

  it("returns the review with the error when only the writer fails", async () => {
    const input = CreativeReviewInputSchema.parse({ draft: "Card 1" })
    const withNote = {
      ...review,
      items: [
        { target: "card 1", problem: "p", suggestion: "s", severity: "major" },
      ],
    }
    const out = await runCreativeReviewWorkflow(input, {
      runId: "r4",
      llm: (model) => ({
        model,
        complete: async (call) => {
          if (model.startsWith("anthropic/")) throw new Error("finish: length")
          return call.schema.parse(withNote)
        },
      }),
    })
    expect(out).toMatchObject({ ok: true, revisionError: "finish: length" })
  })

  it("closes the model choice and bounds the text on the hosted path", () => {
    for (const body of [
      { draft: "x", reviewerModel: "openai/o9-pro" },
      { draft: "x".repeat(40_001) },
      { draft: "x", lang: "english please" },
      { draft: "x", extra: true },
    ])
      expect(CreativeReviewInputSchema.safeParse(body).success).toBe(false)
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
    expect(res.body).toMatchObject({ result: { ok: true } })
  })

  it("maps failures to 503 and 502, and a thrown launch to 502", async () => {
    const call = (
      launch: Parameters<typeof handleCreativeReviewRouteRequest>[0]["launch"],
    ) =>
      handleCreativeReviewRouteRequest({
        authHeader: "Bearer k",
        serviceKeys: ["k"],
        readJson: async () => ({ draft: "Card 1" }),
        launch,
      })
    const fail =
      (reason: "config_missing" | "provider_failed") =>
      async (_: unknown, { runId }: { runId: string }) => ({
        ok: false as const,
        reason,
        message: "m",
        mastraRunId: runId,
      })
    expect((await call(fail("config_missing"))).status).toBe(503)
    expect((await call(fail("provider_failed"))).status).toBe(502)
    expect(
      (
        await call(async () => {
          throw new Error("boom")
        })
      ).status,
    ).toBe(502)
  })

  it("rejects an unreadable body", async () => {
    const res = await handleCreativeReviewRouteRequest({
      authHeader: "Bearer k",
      serviceKeys: ["k"],
      readJson: async () => {
        throw new SyntaxError("bad json")
      },
    })
    expect(res.status).toBe(400)
  })
})
