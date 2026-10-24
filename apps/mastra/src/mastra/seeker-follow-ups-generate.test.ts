import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Mastra } from "@mastra/core"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MastraModelConfig } from "@mastra/core/llm"

import {
  FOLLOW_UPS_GENERATION_BUDGET_MS,
  FOLLOW_UPS_MIN_ANSWER_CHARS,
} from "./seeker-follow-ups"
import {
  FOLLOW_UPS_AGENT_ID,
  FOLLOW_UPS_MAX_OUTPUT_TOKENS,
  buildFollowUpsGeneratorAgent,
  generateSeekerFollowUps,
  registerFollowUpsMastra,
  __resetFollowUpsGeneratorForTesting,
  type FollowUpsAgentLike,
  type FollowUpsGenerateSeam,
} from "./seeker-follow-ups-generate"

const ANSWER = "a".repeat(FOLLOW_UPS_MIN_ANSWER_CHARS)

afterEach(() => {
  __resetFollowUpsGeneratorForTesting()
  vi.restoreAllMocks()
})

function seamReturning(text: string): FollowUpsGenerateSeam {
  return async () => ({ text })
}

describe("generateSeekerFollowUps — outcomes", () => {
  it("returns projected questions from the seam", async () => {
    const outcome = await generateSeekerFollowUps({
      question: "who is jesus",
      answer: ANSWER,
      generateSeam: seamReturning('["Why pray?", "Who wrote the gospels?"]'),
    })
    expect(outcome.questions).toEqual(["Why pray?", "Who wrote the gospels?"])
    expect(outcome.reason).toBeUndefined()
  })

  it("skips the model call entirely on an empty answer", async () => {
    const seam = vi.fn(seamReturning('["x?"]'))
    const outcome = await generateSeekerFollowUps({
      question: "q",
      answer: "   ",
      generateSeam: seam,
    })
    expect(seam).not.toHaveBeenCalled()
    expect(outcome.questions).toEqual([])
    expect(outcome.reason).toBe("skipped_empty")
  })

  it("degrades a rejecting seam to no questions without throwing", async () => {
    const outcome = await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      generateSeam: async () => {
        throw new Error("provider exploded")
      },
    })
    expect(outcome.questions).toEqual([])
    expect(outcome.reason).toBe("generation_failed")
  })

  it("degrades a SYNCHRONOUSLY throwing seam to no questions without throwing (KTD6 containment)", async () => {
    const seam = (() => {
      throw new Error("sync explosion")
    }) as unknown as FollowUpsGenerateSeam
    const outcome = await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      generateSeam: seam,
    })
    expect(outcome.questions).toEqual([])
    expect(outcome.reason).toBe("generation_failed")
  })

  it("reports no_questions when the reply projects to nothing", async () => {
    const outcome = await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      generateSeam: seamReturning("no array here"),
    })
    expect(outcome.questions).toEqual([])
    expect(outcome.reason).toBe("no_questions")
  })

  it("emits no console output carrying any substring of the model reply on a failing parse (R9 no-leak)", async () => {
    const logSpy = vi.spyOn(console, "log")
    const warnSpy = vi.spyOn(console, "warn")
    const errorSpy = vi.spyOn(console, "error")
    const reply = "SECRET-REPLY-FRAGMENT not a json array"
    await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      generateSeam: seamReturning(reply),
    })
    const lines = [logSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls)
      .map((call) => call.map(String).join(" "))
    expect(lines.some((line) => line.includes("SECRET-REPLY"))).toBe(false)
  })
})

describe("generateSeekerFollowUps — budget and abort mechanism (KTD6)", () => {
  // Tiny REAL budgets throughout: fake timers cannot intercept
  // AbortSignal.timeout (the repo's abort-mechanism test law).

  it("aborts the seam via its signal at the budget", async () => {
    let captured: AbortSignal | undefined
    const seam: FollowUpsGenerateSeam = ({ abortSignal }) => {
      captured = abortSignal
      return new Promise((_, reject) => {
        abortSignal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        )
      })
    }
    const outcome = await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      budgetMs: 25,
      generateSeam: seam,
    })
    expect(captured?.aborted).toBe(true)
    expect(outcome.questions).toEqual([])
    expect(outcome.reason).toBe("timeout")
  })

  it("aborts the seam when the COMPOSED turn signal fires first", async () => {
    const turnController = new AbortController()
    let captured: AbortSignal | undefined
    const seam: FollowUpsGenerateSeam = ({ abortSignal }) => {
      captured = abortSignal
      return new Promise((_, reject) => {
        abortSignal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        )
      })
    }
    const pending = generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      budgetMs: 5_000,
      turnSignal: turnController.signal,
      generateSeam: seam,
    })
    turnController.abort()
    const outcome = await pending
    expect(captured?.aborted).toBe(true)
    expect(outcome.questions).toEqual([])
    expect(outcome.reason).toBe("aborted")
  })

  it("never orphans the seam promise when the turn signal is ALREADY aborted (feat-366 review #1 — the settleWithinBudget fast path)", async () => {
    // A client disconnect can abort the route's composed signal in the gap
    // between drain completion and the follow-ups gate. The generator then
    // hands settleWithinBudget an already-aborted signal; its fast path must
    // still settle the in-flight seam promise, or that promise's later
    // rejection escapes as an unhandled rejection (process-fatal by default).
    const escaped: unknown[] = []
    const listener = (reason: unknown) => {
      escaped.push(reason)
    }
    process.on("unhandledRejection", listener)
    try {
      let rejectLater!: () => void
      const seam: FollowUpsGenerateSeam = () =>
        new Promise((_, reject) => {
          rejectLater = () => reject(new Error("late provider failure"))
        })
      const outcome = await generateSeekerFollowUps({
        question: "q",
        answer: ANSWER,
        budgetMs: 5_000,
        turnSignal: AbortSignal.abort(),
        generateSeam: seam,
      })
      expect(outcome.questions).toEqual([])
      expect(outcome.reason).toBe("aborted")
      rejectLater()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(escaped).toEqual([])
    } finally {
      process.removeListener("unhandledRejection", listener)
    }
  })

  it("releases at the budget even when the seam IGNORES its abort signal (the KTD6 race)", async () => {
    // The signal stops provider work; the race releases the terminal frame
    // even if a framework layer ignored the abort.
    const never: FollowUpsGenerateSeam = () => new Promise(() => {})
    const started = Date.now()
    const outcome = await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      budgetMs: 30,
      generateSeam: never,
    })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(outcome.questions).toEqual([])
    expect(outcome.reason).toBe("timeout")
  })

  it("returns timeout WITHOUT invoking the seam when the derived budget is already exhausted (review gap #5)", async () => {
    // The route derives min(2.5s, remaining turn budget); a drain that ate
    // the whole turn can hand this a non-positive budget.
    for (const budgetMs of [0, -25]) {
      const seam = vi.fn(seamReturning('["x?"]'))
      const outcome = await generateSeekerFollowUps({
        question: "q",
        answer: ANSWER,
        budgetMs,
        generateSeam: seam,
      })
      expect(seam).not.toHaveBeenCalled()
      expect(outcome.questions).toEqual([])
      expect(outcome.reason).toBe("timeout")
    }
  })

  it("propagates trace/span ids from the raw output and omits junk shapes (review gap #4 — readTraceIds)", async () => {
    const withIds = await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      generateSeam: async () => ({
        text: '["Why pray?"]',
        traceId: "trace-abc",
        spanId: "span-def",
      }),
    })
    expect(withIds.traceId).toBe("trace-abc")
    expect(withIds.spanId).toBe("span-def")

    const withJunk = await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      generateSeam: async () => ({
        text: '["Why pray?"]',
        traceId: 42,
        spanId: "",
      }),
    })
    expect(withJunk.traceId).toBeUndefined()
    expect(withJunk.spanId).toBeUndefined()
  })

  it("defaults the budget to FOLLOW_UPS_GENERATION_BUDGET_MS", async () => {
    let sawBudgetSignal = false
    const seam: FollowUpsGenerateSeam = ({ abortSignal }) => {
      sawBudgetSignal = abortSignal instanceof AbortSignal
      return Promise.resolve({ text: '["Why pray?"]' })
    }
    const outcome = await generateSeekerFollowUps({
      question: "q",
      answer: ANSWER,
      generateSeam: seam,
    })
    expect(sawBudgetSignal).toBe(true)
    expect(outcome.questions).toEqual(["Why pray?"])
    expect(FOLLOW_UPS_GENERATION_BUDGET_MS).toBe(2_500)
  })
})

// ===========================================================================
// KTD10 dist-fact pin: usage is a PLAIN value on generate()'s resolved output
// — exercised through a REAL Agent over MockLanguageModelV3, not a seam.
// ===========================================================================

const MOCK_USAGE = {
  inputTokens: { total: 17, noCache: 17, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
}

type MockDoStreamReturn = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>
type MockStreamPart = MockDoStreamReturn extends {
  stream: ReadableStream<infer P>
}
  ? P
  : never
type MockDoGenerateReturn = Awaited<
  ReturnType<MockLanguageModelV3["doGenerate"]>
>

function mockModel(replyText: string, withUsage: boolean): MockLanguageModelV3 {
  // `generate()` consumes doGenerate on the pinned core; doStream stays as a
  // safety net so a core that streams internally still resolves.
  const usage = (withUsage ? MOCK_USAGE : {}) as MockDoGenerateReturn["usage"]
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: replyText }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream<MockStreamPart>({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: replyText },
          { type: "text-end", id: "0" },
          {
            type: "finish",
            finishReason: { unified: "stop" as const, raw: "stop" },
            ...(withUsage ? { usage: MOCK_USAGE } : {}),
          },
        ] as MockStreamPart[],
      }),
    }),
  })
}

function realAgentOutcome(replyText: string, withUsage: boolean) {
  const agent = buildFollowUpsGeneratorAgent({
    models: [
      {
        model: mockModel(replyText, withUsage) as unknown as MastraModelConfig,
        maxRetries: 0,
      },
    ],
  })
  return generateSeekerFollowUps({
    question: "who is jesus",
    answer: ANSWER,
    agent,
  })
}

describe("generateSeekerFollowUps — real-agent usage extraction (KTD10 dist-fact pin)", () => {
  it("reads token counts from a model that reports usage", async () => {
    const outcome = await realAgentOutcome('["Why pray?"]', true)
    expect(outcome.questions).toEqual(["Why pray?"])
    expect(outcome.tokensIn).toBe(17)
    expect(outcome.tokensOut).toBe(9)
  })

  it("reports -1 when the provider reports no usage", async () => {
    const outcome = await realAgentOutcome('["Why pray?"]', false)
    expect(outcome.questions).toEqual(["Why pray?"])
    expect(outcome.tokensIn).toBe(-1)
    expect(outcome.tokensOut).toBe(-1)
  })
})

// ===========================================================================
// Output-cap wiring: @mastra/core 1.55.0's generate() never reads a top-level
// maxOutputTokens option — the provider cap travels ONLY via modelSettings
// (verified against the installed dist 2026-08-28; re-verify on bumps). These
// pins keep the cap on the honored slot so it cannot silently revert to the
// unread top-level key.
// ===========================================================================

describe("generateSeekerFollowUps — output cap rides modelSettings", () => {
  it("passes maxOutputTokens inside modelSettings and NEVER as a top-level generate option", async () => {
    let captured: Record<string, unknown> | undefined
    const agent: FollowUpsAgentLike = {
      generate: async (_prompt, options) => {
        captured = options as Record<string, unknown>
        return { text: '["Why pray?"]' }
      },
    }
    const outcome = await generateSeekerFollowUps({
      question: "who is jesus",
      answer: ANSWER,
      agent,
    })
    expect(outcome.questions).toEqual(["Why pray?"])
    expect(captured).toBeDefined()
    expect(captured?.modelSettings).toEqual({
      maxOutputTokens: FOLLOW_UPS_MAX_OUTPUT_TOKENS,
    })
    // A top-level key here is silently dropped: the model call is rebuilt
    // from an explicit field list that carries only modelSettings.
    expect(captured && "maxOutputTokens" in captured).toBe(false)
  })

  it("source pin: the default seam spells the cap as modelSettings.maxOutputTokens", () => {
    const source = readFileSync(
      join(__dirname, "seeker-follow-ups-generate.ts"),
      "utf8",
    )
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
    expect(withoutComments).toMatch(
      /modelSettings:\s*\{\s*maxOutputTokens:\s*FOLLOW_UPS_MAX_OUTPUT_TOKENS,?\s*\}/,
    )
    // Anti-revert companion: no top-level spelling anywhere outside comments.
    expect(withoutComments).not.toMatch(
      /^\s*maxOutputTokens:\s*FOLLOW_UPS_MAX_OUTPUT_TOKENS/m,
    )
  })
})

// ===========================================================================
// KTD5 containment pin: registration stores the Mastra reference WITHOUT
// entering the agents registry, and the generator stays zero-tool /
// zero-processor — the emptiness, not registry absence alone, is what keeps
// the shared instance's tool and processor registries untouched.
// ===========================================================================

describe("follow-ups generator — containment (KTD5)", () => {
  it("stays OUT of the agents registry after registration, with empty tool and processor sets", async () => {
    const probe = new Mastra({ agents: {} as never })
    registerFollowUpsMastra(probe)

    // Registry absence: the dist registration hook stores the reference only.
    expect(() =>
      (
        probe as unknown as { getAgentById: (id: string) => unknown }
      ).getAgentById(FOLLOW_UPS_AGENT_ID),
    ).toThrow()
    // The instance's global tool registry stays untouched.
    expect(
      Object.keys(
        (
          probe as unknown as { listTools: () => Record<string, unknown> }
        ).listTools(),
      ),
    ).toStrictEqual([])

    // Zero-tool / zero-processor on the agent itself — the real surface
    // containment.
    const agent = buildFollowUpsGeneratorAgent()
    expect(Object.keys(await agent.listTools())).toStrictEqual([])
    const processors = await agent.getConfiguredProcessorIds()
    expect(processors.inputProcessorIds).toStrictEqual([])
    expect(processors.outputProcessorIds).toStrictEqual([])
    expect(processors.errorProcessorIds).toStrictEqual([])
  })

  it("registration is a one-time latch and never throws on a structural fake", () => {
    // The route hands over whatever its getMastra() seam returns; a fake
    // without getLogger must not blow up the turn (R5 containment).
    expect(() => registerFollowUpsMastra({})).not.toThrow()
    expect(() => registerFollowUpsMastra({})).not.toThrow()
  })
})
