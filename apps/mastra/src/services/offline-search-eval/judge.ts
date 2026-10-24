import { z } from "zod"

import { env, getOpenRouterApiKey } from "../../config/env"
import {
  DEFAULT_SEARCH_EVAL_CALLER_TRACK,
  normalizeSearchEvalCallerTrack,
  searchEvalCallerTrackDefinition,
} from "./types"
import type { AbsoluteSearchIntent } from "./absolute-query-set"
import type {
  JudgeVerdict,
  SearchEvalCallerTrack,
  SearchEvalResult,
} from "./types"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"
const MAX_RENDERED_FIELD_LENGTH = 240

const VERDICTS = [
  "clearly-A-better",
  "slightly-A-better",
  "tie",
  "slightly-B-better",
  "clearly-B-better",
  "both-irrelevant",
] as const

const POINTWISE_RATINGS = [
  "excellent",
  "useful",
  "weak",
  "unacceptable",
] as const

const JudgeResponseSchema = z
  .object({
    verdict: z.enum(VERDICTS),
    rationale: z.string().trim().min(1).max(1000),
  })
  .strict()

const PointwiseJudgeResponseSchema = z
  .object({
    rating: z.enum(POINTWISE_RATINGS),
    rationale: z.string().trim().min(1).max(1000),
  })
  .strict()

export class OfflineSearchEvalJudgeError extends Error {
  constructor(
    readonly code:
      | "missing_credentials"
      | "transport"
      | "request_failed"
      | "validation",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "OfflineSearchEvalJudgeError"
  }
}

export type JudgePairInput = {
  query: string
  locale: string
  callerTrack?: SearchEvalCallerTrack
  listA: SearchEvalResult[]
  listB: SearchEvalResult[]
}

export type JudgePairResult = {
  verdict: JudgeVerdict
  rationale: string
  tokens: { input: number; output: number }
  model: string
  reportedUsd?: number
}

export type JudgePointwiseInput = {
  query: string
  locale: string
  intent: AbsoluteSearchIntent
  results: SearchEvalResult[]
}

export type JudgePointwiseResult = {
  rating: (typeof POINTWISE_RATINGS)[number]
  rationale: string
  tokens: { input: number; output: number }
  model: string
  reportedUsd?: number
}

export type OfflineSearchEvalPairwiseJudge = {
  readonly model: string
  readonly provider?: string
  judgePair: (input: JudgePairInput) => Promise<JudgePairResult>
}

export type OfflineSearchEvalJudge = OfflineSearchEvalPairwiseJudge & {
  judgePointwise: (input: JudgePointwiseInput) => Promise<JudgePointwiseResult>
}

function renderResults(results: readonly SearchEvalResult[]): string {
  if (results.length === 0) return "(empty list)"
  return results
    .map((result, index) => {
      const snippet =
        result.snippet.length > 0
          ? truncateForJudge(result.snippet)
          : "(no snippet)"
      return `${index + 1}. ${truncateForJudge(result.title)} - ${snippet}`
    })
    .join("\n")
}

function truncateForJudge(value: string): string {
  const codepoints = Array.from(value.replace(/\s+/g, " ").trim())
  if (codepoints.length <= MAX_RENDERED_FIELD_LENGTH) return codepoints.join("")
  return `${codepoints.slice(0, MAX_RENDERED_FIELD_LENGTH - 1).join("")}…`
}

function requestBody(model: string, input: JudgePairInput) {
  const callerTrack = normalizeSearchEvalCallerTrack(
    input.callerTrack ?? DEFAULT_SEARCH_EVAL_CALLER_TRACK,
  )
  const definition = searchEvalCallerTrackDefinition(callerTrack)
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "Compare two ranked search result lists for relevance.",
          `Caller track: ${definition.id}.`,
          `Caller: ${definition.caller}.`,
          `Job: ${definition.job}.`,
          `Rubric: ${definition.judgeRubric}`,
          `Success criteria: ${definition.successCriteria.join(" ")}`,
          "Choose both-irrelevant only if neither list is useful.",
          "Return JSON only.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Query: ${input.query}`,
          `Locale: ${input.locale}`,
          "List A:",
          renderResults(input.listA),
          "List B:",
          renderResults(input.listB),
        ].join("\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "offline_search_eval_pairwise_verdict",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            verdict: { type: "string", enum: [...VERDICTS] },
            rationale: { type: "string", minLength: 1, maxLength: 1000 },
          },
          required: ["verdict", "rationale"],
        },
      },
    },
    max_tokens: 600,
    temperature: 0.1,
  }
}

function pointwiseRequestBody(model: string, input: JudgePointwiseInput) {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "Judge one public Watch search result list for absolute relevance.",
          "Rate excellent when the leading results directly satisfy the query; useful when the list contains a strong answer with minor ranking issues; weak when only marginally related; unacceptable when empty without good reason, misleading, wrong-language, or irrelevant.",
          "Known product/title intent should prioritize the product family. Semantic intent may be satisfied without shared title words. Penalize duplicate editions of the same video.",
          "Return JSON only.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Query: ${input.query}`,
          `Locale: ${input.locale}`,
          `Intent: ${input.intent}`,
          "Results:",
          renderResults(input.results),
        ].join("\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "offline_search_eval_pointwise_rating",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            rating: { type: "string", enum: [...POINTWISE_RATINGS] },
            rationale: { type: "string", minLength: 1, maxLength: 1000 },
          },
          required: ["rating", "rationale"],
        },
      },
    },
    max_tokens: 600,
    temperature: 0.1,
  }
}

function extractText(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as Record<string, unknown>).message
  if (message == null || typeof message !== "object") return null
  const content = (message as Record<string, unknown>).content
  return typeof content === "string" ? content : null
}

function extractTokens(payload: unknown): { input: number; output: number } {
  if (payload == null || typeof payload !== "object") {
    return { input: 0, output: 0 }
  }
  const usage = (payload as Record<string, unknown>).usage
  if (usage == null || typeof usage !== "object") {
    return { input: 0, output: 0 }
  }
  return {
    input:
      typeof (usage as { prompt_tokens?: unknown }).prompt_tokens === "number"
        ? (usage as { prompt_tokens: number }).prompt_tokens
        : 0,
    output:
      typeof (usage as { completion_tokens?: unknown }).completion_tokens ===
      "number"
        ? (usage as { completion_tokens: number }).completion_tokens
        : 0,
  }
}

function extractReportedUsd(payload: unknown): number | undefined {
  if (payload == null || typeof payload !== "object") return undefined
  const usage = (payload as Record<string, unknown>).usage
  if (usage == null || typeof usage !== "object") return undefined
  const cost = (usage as { cost?: unknown }).cost
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : undefined
}

export function createOfflineSearchEvalJudge(
  options: {
    apiKey?: string
    model?: string
    timeoutMs?: number
    fetchImpl?: typeof fetch
    maxAttempts?: number
    sleep?: (ms: number) => Promise<void>
  } = {},
): OfflineSearchEvalJudge {
  const apiKey = options.apiKey ?? getOpenRouterApiKey()
  if (!apiKey) {
    throw new OfflineSearchEvalJudgeError(
      "missing_credentials",
      "OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY is required for offline search eval judging",
    )
  }
  const model = options.model ?? env.SEARCH_EVAL_JUDGE_MODEL
  const timeoutMs = options.timeoutMs ?? 45_000
  const fetchImpl = options.fetchImpl ?? fetch
  const maxAttempts = options.maxAttempts ?? 3
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  function retryAfterMs(response: Response, attempt: number): number {
    const header = response.headers.get("retry-after")
    const seconds = header == null ? Number.NaN : Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000)
    }
    return Math.min(500 * 2 ** (attempt - 1), 30_000)
  }

  async function requestJudge(body: unknown): Promise<unknown> {
    let response: Response | null = null
    let lastTransportError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://mastra.jesusfilm.org",
            "X-OpenRouter-Title": "Forge Mastra Offline Search Eval",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        lastTransportError = cause
        if (attempt < maxAttempts) {
          await sleep(Math.min(500 * 2 ** (attempt - 1), 30_000))
          continue
        }
        throw new OfflineSearchEvalJudgeError(
          "transport",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        )
      }

      if (
        !response.ok &&
        (response.status === 429 || response.status >= 500) &&
        attempt < maxAttempts
      ) {
        await sleep(retryAfterMs(response, attempt))
        continue
      }
      break
    }

    if (response == null) {
      throw new OfflineSearchEvalJudgeError(
        "transport",
        lastTransportError instanceof Error
          ? lastTransportError.message
          : String(lastTransportError),
        lastTransportError,
      )
    }

    if (!response.ok) {
      throw new OfflineSearchEvalJudgeError(
        "request_failed",
        `judge request failed with ${response.status}`,
      )
    }

    return response.json().catch((cause) => {
      throw new OfflineSearchEvalJudgeError(
        "validation",
        "judge response was not valid JSON",
        cause,
      )
    })
  }

  function parseJudgeText(payload: unknown): unknown {
    const text = extractText(payload)
    if (text == null) {
      throw new OfflineSearchEvalJudgeError(
        "validation",
        "judge response did not include text output",
      )
    }
    try {
      return JSON.parse(text)
    } catch (cause) {
      throw new OfflineSearchEvalJudgeError(
        "validation",
        "judge response text was not valid JSON",
        cause,
      )
    }
  }

  return {
    model,
    provider: "openrouter",
    async judgePair(input) {
      const payload = await requestJudge(requestBody(model, input))
      const parsedJson = parseJudgeText(payload)
      const parsed = JudgeResponseSchema.safeParse(parsedJson)
      if (!parsed.success) {
        throw new OfflineSearchEvalJudgeError(
          "validation",
          "judge response failed schema validation",
          parsed.error,
        )
      }

      const reportedUsd = extractReportedUsd(payload)
      return {
        verdict: parsed.data.verdict,
        rationale: parsed.data.rationale,
        tokens: extractTokens(payload),
        model,
        ...(reportedUsd == null ? {} : { reportedUsd }),
      }
    },
    async judgePointwise(input) {
      const payload = await requestJudge(pointwiseRequestBody(model, input))
      const parsed = PointwiseJudgeResponseSchema.safeParse(
        parseJudgeText(payload),
      )
      if (!parsed.success) {
        throw new OfflineSearchEvalJudgeError(
          "validation",
          "pointwise judge response failed schema validation",
          parsed.error,
        )
      }
      const reportedUsd = extractReportedUsd(payload)
      return {
        rating: parsed.data.rating,
        rationale: parsed.data.rationale,
        tokens: extractTokens(payload),
        model,
        ...(reportedUsd == null ? {} : { reportedUsd }),
      }
    },
  }
}

export const _internal = {
  pointwiseRequestBody,
  requestBody,
}
