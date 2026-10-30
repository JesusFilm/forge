/**
 * Post-hoc follow-up question generation (feat-366 U1 — KTD5, KTD6, KTD10).
 *
 * The generator is an OUT-OF-REGISTRY mini-agent: module-cached, memory-less,
 * ZERO-tool and ZERO-processor, on `buildSeekerModelList()` — the seeker's own
 * env-gated chain — and never added to the instance's `agents` registry. That
 * emptiness (not registry absence alone) is what keeps the shared Mastra
 * instance's tool and processor registries untouched; the containment test
 * pins both together. It IS handed the runtime's Mastra reference once via
 * the dist's internal `__registerMastra` hook: an Agent without that
 * reference creates no tracing spans at all on the pinned core (KTD9). The
 * hook stores the reference without touching the agents registry — a dist
 * fact (verified @mastra/core 1.55.0, 2026-08-18), pinned by test;
 * re-verify on `@mastra/*` bumps.
 *
 * Budget mechanics (KTD6): the call runs under `AbortSignal.timeout(budget)`
 * composed with the turn's already-composed signal via `AbortSignal.any` —
 * the signal stops provider work — AND under a `Promise.race` on the same
 * budget — the race releases the terminal frame even if a framework layer
 * ignored the abort. Verified by hand 2026-08-18 against @mastra/core 1.55.0
 * + p-retry 7.1.1: the core passes the caller's signal into its per-entry
 * p-retry and the fallback loop unwinds promptly on abort, so the race is
 * belt-and-suspenders that survives `@mastra/*` bumps.
 *
 * NEVER throws, and never logs — failure reasons come back as fixed enums for
 * the route's `[seeker-follow-ups]` line (R9: a parse error message can embed
 * the raw reply; question text never reaches a log line).
 */

import { Agent, type ModelWithRetries } from "@mastra/core/agent"

import type { RequestContext } from "@mastra/core/di"

import { buildSeekerModelList } from "./agents/seeker-agent"
import { settleWithinBudget } from "./budgets"
import {
  FOLLOW_UPS_GENERATION_BUDGET_MS,
  SEEKER_FOLLOW_UPS_INSTRUCTIONS,
  buildPostHocFollowUpsPrompt,
  parsePostHocFollowUps,
  projectFollowUps,
} from "./seeker-follow-ups"

/** Agent id — used by the containment pin; never registered under it. */
export const FOLLOW_UPS_AGENT_ID = "seekerFollowUpsGenerator"

/**
 * Output cap for one generation call (repo TOKEN_CAPS convention): three
 * <15-word questions are ~90 tokens; 300 leaves generous headroom while
 * bounding a runaway emission well inside the 2.5s budget.
 */
export const FOLLOW_UPS_MAX_OUTPUT_TOKENS = 300

export type FollowUpsGenerationOutcome = {
  questions: string[]
  /** Provider-reported token counts; -1 when the provider reports none (KTD10). */
  tokensIn: number
  tokensOut: number
  /** Trace ids from the generator call, when tracing produced them (KTD9). */
  traceId?: string
  spanId?: string
  /** Absent on success-with-questions; a fixed enum otherwise (R9). */
  reason?:
    | "skipped_empty"
    | "timeout"
    | "aborted"
    | "generation_failed"
    | "no_questions"
}

/** Tracing pass-through for the generator call (KTD9). */
export type FollowUpsTracingOptions = {
  requestContext?: RequestContext
  tracingOptions?: {
    metadata?: Record<string, unknown>
    traceId?: string
    parentSpanId?: string
  }
}

/** The raw fields this module reads off a generate call's resolved output —
 * everything `unknown` because the seam boundary treats provider output as
 * untrusted (extraction is defensive either way). */
export type FollowUpsGenerateRawResult = {
  text?: unknown
  usage?: unknown
  traceId?: unknown
  spanId?: unknown
}

/**
 * Injectable generate seam (tests). The default seam calls the real cached
 * agent's `generate()`.
 */
export type FollowUpsGenerateSeam = (input: {
  prompt: string
  abortSignal: AbortSignal
  requestContext?: RequestContext
  tracingOptions?: FollowUpsTracingOptions["tracingOptions"]
}) => Promise<FollowUpsGenerateRawResult>

/** Narrow generate surface of the generator agent (structural for tests).
 * Deliberately declares NO top-level `maxOutputTokens`: the runtime never
 * reads that slot (see the dist-fact comment at the default seam), so
 * declaring it would let the cap silently revert to a no-op. The honored
 * home is `modelSettings`. */
export type FollowUpsAgentLike = {
  generate: (
    prompt: string,
    options: {
      abortSignal?: AbortSignal
      modelSettings?: { maxOutputTokens?: number }
      requestContext?: RequestContext
      tracingOptions?: FollowUpsTracingOptions["tracingOptions"]
    },
  ) => Promise<FollowUpsGenerateRawResult>
}

/**
 * Build the generator agent. ZERO tools, ZERO processors, NO memory —
 * deliberate (KTD5): the shared instance's registries stay untouched, and a
 * memory-less agent can never adopt or write a thread. `models` is
 * overridable so tests can drive a real Agent over a mock model (the KTD10
 * usage pin); production consumes the module-cached default below.
 */
export function buildFollowUpsGeneratorAgent(overrides?: {
  models?: ModelWithRetries[]
}): Agent {
  return new Agent({
    id: FOLLOW_UPS_AGENT_ID,
    name: "Seeker Follow-Ups Generator",
    description:
      "Internal post-hoc generator for the seeker's suggested follow-up questions. Never registered; never tool-calling.",
    instructions: SEEKER_FOLLOW_UPS_INSTRUCTIONS,
    model: overrides?.models ?? buildSeekerModelList(),
  })
}

let cachedAgent: Agent | null = null
let mastraRegistered = false

function getFollowUpsGeneratorAgent(): Agent {
  if (cachedAgent === null) {
    cachedAgent = buildFollowUpsGeneratorAgent()
  }
  return cachedAgent
}

/**
 * Hand the runtime Mastra reference to the cached generator ONCE (KTD5/KTD9
 * — without it the pinned core creates no tracing spans at all). One-time
 * latch; total: a structural fake (tests pass the route's getMastra() value)
 * must never throw into the turn (R5).
 */
export function registerFollowUpsMastra(mastra: unknown): void {
  if (mastraRegistered) return
  try {
    getFollowUpsGeneratorAgent().__registerMastra(
      mastra as Parameters<Agent["__registerMastra"]>[0],
    )
    mastraRegistered = true
  } catch {
    // Registration is observability plumbing only — a failure costs spans,
    // never the turn. Leave the latch unset so a later real instance can try.
  }
}

/** Test-only reset. Production never resets — the cache is the point. */
export function __resetFollowUpsGeneratorForTesting(): void {
  cachedAgent = null
  mastraRegistered = false
}

function readTokenCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "object" && value !== null) {
    const total = (value as { total?: unknown }).total
    if (typeof total === "number" && Number.isFinite(total)) return total
  }
  return -1
}

function readTraceIds(raw: { traceId?: unknown; spanId?: unknown }): {
  traceId?: string
  spanId?: string
} {
  return {
    ...(typeof raw.traceId === "string" && raw.traceId.length > 0
      ? { traceId: raw.traceId }
      : {}),
    ...(typeof raw.spanId === "string" && raw.spanId.length > 0
      ? { spanId: raw.spanId }
      : {}),
  }
}

/**
 * Generate follow-up questions for one turn. NEVER throws; every failure —
 * rejection, sync throw, abort, budget expiry, junk reply — degrades to
 * `{ questions: [] }` with a fixed reason enum (R5).
 *
 * The resolved value is THE raced value: a race loss returns empty questions,
 * so the caller's persist consumes exactly what the terminal frame carried
 * (KTD6 — a race loss stores nothing).
 */
export async function generateSeekerFollowUps(input: {
  question: string
  answer: string
  /** Effective deadline — the route passes `min(2.5s, remaining budget)`. */
  budgetMs?: number
  /** The turn's already-composed signal (inbound request + chatTurn). */
  turnSignal?: AbortSignal
  requestContext?: RequestContext
  tracingOptions?: FollowUpsTracingOptions["tracingOptions"]
  /** Per-call agent override (tests: a real Agent over a mock model). */
  agent?: FollowUpsAgentLike
  generateSeam?: FollowUpsGenerateSeam
}): Promise<FollowUpsGenerationOutcome> {
  const empty = (
    reason: NonNullable<FollowUpsGenerationOutcome["reason"]>,
  ): FollowUpsGenerationOutcome => ({
    questions: [],
    tokensIn: -1,
    tokensOut: -1,
    reason,
  })

  if (input.answer.trim().length === 0) return empty("skipped_empty")

  const budgetMs = input.budgetMs ?? FOLLOW_UPS_GENERATION_BUDGET_MS
  if (budgetMs <= 0) return empty("timeout")

  const budgetSignal = AbortSignal.timeout(budgetMs)
  const abortSignal = input.turnSignal
    ? AbortSignal.any([input.turnSignal, budgetSignal])
    : budgetSignal

  const seam: FollowUpsGenerateSeam =
    input.generateSeam ??
    (async (seamInput) => {
      const agent = input.agent ?? getFollowUpsGeneratorAgent()
      // The cap MUST ride modelSettings: the runtime never reads a top-level
      // maxOutputTokens — generate() spreads the caller's options wholesale,
      // but the model call is rebuilt from an explicit field list that
      // carries only modelSettings, so a top-level key is a silent no-op
      // (verified 2026-08-28 vs @mastra/core 1.55.0 dist; re-verify on
      // bumps). Pinned by the modelSettings tests in the sibling suite.
      const output = await agent.generate(seamInput.prompt, {
        abortSignal: seamInput.abortSignal,
        modelSettings: { maxOutputTokens: FOLLOW_UPS_MAX_OUTPUT_TOKENS },
        requestContext: seamInput.requestContext,
        tracingOptions: seamInput.tracingOptions,
      })
      return {
        text: output.text,
        usage: output.usage,
        traceId: output.traceId,
        spanId: output.spanId,
      }
    })

  const prompt = buildPostHocFollowUpsPrompt({
    question: input.question,
    answer: input.answer,
  })

  try {
    // Structural containment: the seam call sits inside this try so a
    // synchronous throw lands here, not in the route's drain loop (KTD6).
    // `settleWithinBudget` IS the KTD6 race: it rejects the moment the
    // composed signal fires — budget expiry or turn abort — so the terminal
    // frame releases even when a framework layer ignores the abort. On BOTH
    // of its branches (normal, and the already-aborted fast path a fired
    // turn signal can reach) it settles the seam promise, so a late
    // rejection can never escape unhandled — the fast-path half is pinned by
    // its own regression test in budgets.test.ts and here.
    const raced = await settleWithinBudget(
      seam({
        prompt,
        abortSignal,
        requestContext: input.requestContext,
        tracingOptions: input.tracingOptions,
      }),
      abortSignal,
    )

    const questions = projectFollowUps(
      parsePostHocFollowUps(typeof raced.text === "string" ? raced.text : ""),
    )
    const outcome: FollowUpsGenerationOutcome = {
      questions,
      tokensIn: readTokenCount(
        (raced.usage as { inputTokens?: unknown } | null | undefined)
          ?.inputTokens,
      ),
      tokensOut: readTokenCount(
        (raced.usage as { outputTokens?: unknown } | null | undefined)
          ?.outputTokens,
      ),
      ...readTraceIds(raced),
    }
    return questions.length === 0
      ? { ...outcome, reason: "no_questions" }
      : outcome
  } catch {
    // Fixed enums only — the caught error can embed the raw reply (R9).
    if (input.turnSignal?.aborted) return empty("aborted")
    if (budgetSignal.aborted) return empty("timeout")
    return empty("generation_failed")
  }
}
