import { describe, expect, it } from "vitest"

import { evaluateSafety as evaluateSafetyWithPolicy } from "./safety-gate"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import type { Devotional } from "./types"

const DEVOTIONAL: Devotional = {
  date: "2026-06-22",
  hook: {
    type: "question",
    title: "Where do you find peace?",
    summary: "An invitation to rest in Christ.",
    sourceUrl: null,
  },
  scripture: {
    reference: "John 14:27",
    text: "Peace I leave with you.",
    translation: "NIV",
    needsCanonicalSource: true,
  },
  video: null,
  videoMatch: "none",
  reflection: "Peace is the presence of Christ in the storm.",
  questions: ["Where is your fear loudest?"],
  furtherReading: null,
  blockOrder: ["hook", "scripture", "reflection", "questions"],
}

function llmReturning(value: unknown): DevotionalLlm {
  return { model: "test-model", complete: async () => value as never }
}

/** Captures the `user` prompt the judge is shown, so we can assert what it scores. */
function llmCapturing(
  capture: { user?: string },
  value: unknown,
): DevotionalLlm {
  return {
    model: "test-model",
    complete: async (req: { user: string }) => {
      capture.user = req.user
      return value as never
    },
  }
}

function llmThrowing(error: unknown): DevotionalLlm {
  return {
    model: "test-model",
    complete: async () => {
      throw error
    },
  }
}

function evaluateSafety(
  options: Omit<Parameters<typeof evaluateSafetyWithPolicy>[0], "systemPrompt">,
) {
  return evaluateSafetyWithPolicy({
    ...options,
    systemPrompt:
      "Strictly score doctrine, tone, and sensitivity; return JSON.",
  })
}

describe("evaluateSafety", () => {
  it("passes a clean devotional with high scores", async () => {
    const verdict = await evaluateSafety({
      devotional: DEVOTIONAL,
      llm: llmReturning({
        verdict: "pass",
        doctrine: 0.95,
        tone: 0.92,
        sensitivity: 0.9,
        reasons: [],
      }),
    })

    expect(verdict.verdict).toBe("pass")
    expect(verdict.scores.doctrine).toBeGreaterThan(0.6)
  })

  it("feeds the guided prayer to the judge so it is scored", async () => {
    const cap: { user?: string } = {}
    await evaluateSafety({
      devotional: {
        ...DEVOTIONAL,
        prayer: "Father, teach me to name my riches and claim them from you.",
      },
      llm: llmCapturing(cap, {
        verdict: "pass",
        doctrine: 0.95,
        tone: 0.9,
        sensitivity: 0.9,
        reasons: [],
      }),
    })
    expect(cap.user).toContain("name my riches and claim them")
  })

  it("blocks a doctrinally wrong devotional with a doctrine reason", async () => {
    const verdict = await evaluateSafety({
      devotional: DEVOTIONAL,
      llm: llmReturning({
        verdict: "block",
        doctrine: 0.2,
        tone: 0.8,
        sensitivity: 0.8,
        reasons: ["doctrine: misrepresents the resurrection"],
      }),
    })

    expect(verdict.verdict).toBe("block")
    expect(verdict.reasons.join(" ")).toMatch(/doctrine/i)
  })

  it("blocks partisan political framing with a sensitivity reason", async () => {
    const verdict = await evaluateSafety({
      devotional: DEVOTIONAL,
      llm: llmReturning({
        verdict: "block",
        doctrine: 0.9,
        tone: 0.8,
        sensitivity: 0.1,
        reasons: ["sensitivity: takes a partisan political side"],
      }),
    })

    expect(verdict.verdict).toBe("block")
    expect(verdict.reasons.join(" ")).toMatch(/partisan|sensitivity/i)
  })

  it("blocks a tragedy framed opportunistically with a tone reason", async () => {
    const verdict = await evaluateSafety({
      devotional: DEVOTIONAL,
      llm: llmReturning({
        verdict: "block",
        doctrine: 0.9,
        tone: 0.2,
        sensitivity: 0.7,
        reasons: ["tone: exploits a tragedy for engagement"],
      }),
    })

    expect(verdict.verdict).toBe("block")
    expect(verdict.reasons.join(" ")).toMatch(/tone|tragedy/i)
  })

  it("blocks on ambiguous/low-confidence output even when the judge says pass", async () => {
    const verdict = await evaluateSafety({
      devotional: DEVOTIONAL,
      llm: llmReturning({
        // Judge recommends pass, but one dimension is below threshold.
        verdict: "pass",
        doctrine: 0.45,
        tone: 0.8,
        sensitivity: 0.8,
        reasons: [],
      }),
    })

    expect(verdict.verdict).toBe("block")
    expect(verdict.reasons.join(" ")).toMatch(/low confidence/i)
  })

  it("fails closed (blocks) when the judge call errors", async () => {
    const verdict = await evaluateSafety({
      devotional: DEVOTIONAL,
      llm: llmThrowing(new DevotionalLlmError("transport", "network down")),
    })

    expect(verdict.verdict).toBe("block")
    expect(verdict.scores).toEqual({ doctrine: 0, tone: 0, sensitivity: 0 })
    expect(verdict.reasons.join(" ")).toMatch(/failing closed/i)
  })
})
