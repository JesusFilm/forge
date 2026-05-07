/**
 * Pairwise relevance judge for the eval harness.
 *
 * Wraps a single OpenRouter chat-completions call that compares two
 * ranked search-result lists for a given query and returns one of six
 * verdicts (the five-rung A/B ladder plus `both-irrelevant`).
 *
 * Design constraints (see plan §Unit 3):
 * - Structured output: OpenRouter `response_format: json_schema` +
 *   Zod re-parse on the client side. Drift between the two schemas is
 *   a known recurring class — both lists must stay aligned.
 * - Per-attempt `AbortSignal.timeout`, not per-operation, so retries
 *   get a fresh budget.
 * - Retry on 5xx / 429 / transport errors. Max 3 attempts. Honor
 *   `Retry-After` (capped at 30s).
 * - Default model `anthropic/claude-haiku-4-5`, override via
 *   `OPENROUTER_JUDGE_MODEL` env. The repo has no other Haiku 4.5
 *   call sites yet — this module is the first user.
 * - Token counts surfaced for cost tracking.
 *
 * Mirrors the AbortController + typed-error pattern from
 * `embeddings.service.ts` and the OpenRouter request shape from
 * `image-text-generation.service.ts`.
 */

import { z } from "zod"

import { env } from "@/config/env"

import type { SearchResult, Verdict } from "./types"

/** Default judge model. Override via `OPENROUTER_JUDGE_MODEL`. Verify
 *  the exact OpenRouter id with `curl https://openrouter.ai/api/v1/models`
 *  on first build if this constant produces a 404. */
export const DEFAULT_JUDGE_MODEL = "anthropic/claude-haiku-4-5"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"

const JUDGE_REQUEST_TIMEOUT_MS = 45_000
const MAX_RETRY_ATTEMPTS = 3
const RETRY_AFTER_CAP_MS = 30_000
const RETRY_BASE_DELAY_MS = 500

/** Six verdicts; matches the union in `types.ts`. */
const VERDICT_VALUES = [
  "clearly-A-better",
  "slightly-A-better",
  "tie",
  "slightly-B-better",
  "clearly-B-better",
  "both-irrelevant",
] as const

const JudgeResponseSchema = z.object({
  verdict: z.enum(VERDICT_VALUES),
  rationale: z.string().trim().min(1).max(1000),
})

/**
 * Discriminated error class so callers branch on `code`. Mirrors
 * `EmbeddingsBatchError` shape.
 */
export class JudgeError extends Error {
  constructor(
    readonly code:
      | "missing_credentials"
      | "validation"
      | "retry_exhausted"
      | "timeout"
      | "transport"
      | "rate_limited",
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "JudgeError"
  }
}

export type JudgePairInput = {
  query: string
  locale: string
  listA: SearchResult[]
  listB: SearchResult[]
}

export type JudgeVerdictResult = {
  verdict: Verdict
  rationale: string
  tokens: { input: number; output: number }
  attempts: number
  model: string
}

export type CreateJudgeOptions = {
  /** Override `fetch` for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Override the model id. Defaults to env `OPENROUTER_JUDGE_MODEL`
   *  then `DEFAULT_JUDGE_MODEL`. */
  model?: string
  /** Override the API key. Defaults to env `OPENROUTER_API_KEY`. */
  apiKey?: string
  /** Override per-attempt timeout. Tests use a tiny value. */
  timeoutMs?: number
  /** Override max attempts. Tests use 1 to assert single-shot paths. */
  maxAttempts?: number
  /** Override the sleep-between-retries function. Tests stub it to
   *  zero so retries are instant. */
  sleep?: (ms: number) => Promise<void>
  /** Override the structured logger. Defaults to a console-tagged
   *  emitter that matches admin's `[search] event=...` shape. */
  logger?: { warn: (message: string) => void; info: (message: string) => void }
}

export type Judge = {
  judgePair: (input: JudgePairInput) => Promise<JudgeVerdictResult>
  /** The model id this judge instance was bound to. Surfaced into
   *  `RunReport.judgeModel`. */
  readonly model: string
}

/** Renders a result list for the judge prompt. Snippet is assumed to
 *  be pre-truncated by the search client. */
function renderResultList(results: SearchResult[]): string {
  if (results.length === 0) return "(empty list)"
  return results
    .map((r, idx) => {
      const snippet = r.snippet.length > 0 ? r.snippet : "(no snippet)"
      return `${idx + 1}. ${r.title} — ${snippet}`
    })
    .join("\n")
}

function buildSystemPrompt(): string {
  return [
    "You are evaluating two ranked search result lists for relevance to a query.",
    "Compare List A and List B holistically: which list as a whole better serves a user searching for this query in this language?",
    "Choose `both-irrelevant` only if NEITHER list contains any result genuinely relevant to the query.",
    "Otherwise pick from the five-rung ladder: `clearly-A-better`, `slightly-A-better`, `tie`, `slightly-B-better`, `clearly-B-better`.",
    "Use `clearly-*` only when the difference is unambiguous; default to `slightly-*` for marginal differences.",
    "Return your verdict and a 1-line rationale (max ~200 chars) explaining the call.",
  ].join("\n")
}

function buildUserPrompt(input: JudgePairInput): string {
  return [
    `Query: "${input.query}"`,
    `Locale: ${input.locale}`,
    "",
    "List A (top results):",
    renderResultList(input.listA),
    "",
    "List B (top results):",
    renderResultList(input.listB),
    "",
    "Compare the two lists. Return JSON matching the schema.",
  ].join("\n")
}

function buildRequestBody(model: string, input: JudgePairInput) {
  return {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "pairwise_verdict",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            verdict: { type: "string", enum: [...VERDICT_VALUES] },
            rationale: { type: "string" },
          },
          required: ["verdict", "rationale"],
        },
      },
    },
    max_tokens: 600,
    temperature: 0.1,
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value == null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS)
  }
  // RFC 7231 also allows an HTTP-date; we don't bother — fall back to
  // exponential backoff.
  return null
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function extractMessageContent(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as Record<string, unknown>).message
  if (message == null || typeof message !== "object") return null
  const content = (message as Record<string, unknown>).content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part == null || typeof part !== "object") continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === "string") return text
    }
  }
  return null
}

function extractTokenCounts(payload: unknown): {
  input: number
  output: number
} {
  if (payload == null || typeof payload !== "object") {
    return { input: 0, output: 0 }
  }
  const usage = (payload as Record<string, unknown>).usage
  if (usage == null || typeof usage !== "object") {
    return { input: 0, output: 0 }
  }
  const u = usage as Record<string, unknown>
  return {
    input:
      typeof u.prompt_tokens === "number"
        ? u.prompt_tokens
        : typeof u.input_tokens === "number"
          ? u.input_tokens
          : 0,
    output:
      typeof u.completion_tokens === "number"
        ? u.completion_tokens
        : typeof u.output_tokens === "number"
          ? u.output_tokens
          : 0,
  }
}

const defaultLogger = {
  warn: (message: string) => console.warn(message),
  info: (message: string) => console.log(message),
}

/**
 * Build a judge client. Factory shape so tests can inject a stub
 * fetch + sleep without `vi.stubGlobal`.
 */
export function createJudge(options: CreateJudgeOptions = {}): Judge {
  const apiKey = options.apiKey ?? env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new JudgeError(
      "missing_credentials",
      "OPENROUTER_API_KEY is required to create a judge",
    )
  }
  const model =
    options.model ?? env.OPENROUTER_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? JUDGE_REQUEST_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? MAX_RETRY_ATTEMPTS
  const sleep = options.sleep ?? defaultSleep
  const logger = options.logger ?? defaultLogger

  return {
    model,
    async judgePair(input) {
      const body = JSON.stringify(buildRequestBody(model, input))
      const failures: string[] = []

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response: Response
        try {
          response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://admin.jesusfilm.org",
              "X-OpenRouter-Title": "Forge Admin Eval Harness",
            },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === "TimeoutError") {
            failures.push(`attempt ${attempt}: timeout after ${timeoutMs}ms`)
            if (attempt < maxAttempts) {
              await sleep(backoffMs(attempt))
              continue
            }
            throw new JudgeError(
              "timeout",
              `judge request timed out after ${timeoutMs}ms (${maxAttempts} attempts)`,
              undefined,
              cause,
            )
          }
          failures.push(
            `attempt ${attempt}: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          )
          if (attempt < maxAttempts) {
            await sleep(backoffMs(attempt))
            continue
          }
          throw new JudgeError(
            "transport",
            `judge transport error after ${maxAttempts} attempts: ${failures.join(" | ")}`,
            undefined,
            cause,
          )
        }

        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < maxAttempts) {
            const retryAfter = parseRetryAfterMs(
              response.headers.get("retry-after"),
            )
            const wait = retryAfter ?? backoffMs(attempt)
            failures.push(`attempt ${attempt}: status ${response.status}`)
            logger.info(
              `[search-eval] event=judge.retry attempt=${attempt} status=${response.status} wait_ms=${wait}`,
            )
            await sleep(wait)
            continue
          }

          const detail = await safeReadBody(response)
          if (response.status === 429) {
            throw new JudgeError(
              "rate_limited",
              `judge rate limited (429) after ${attempt} attempts: ${detail}`,
              429,
            )
          }
          throw new JudgeError(
            "retry_exhausted",
            `judge failed after ${attempt} attempts: ${failures.join(" | ")} | last_status=${response.status} | body=${detail.slice(0, 500)}`,
            response.status,
          )
        }

        let payload: unknown
        try {
          payload = await response.json()
        } catch (cause) {
          throw new JudgeError(
            "validation",
            "judge response was not valid JSON",
            response.status,
            cause,
          )
        }

        const text = extractMessageContent(payload)
        if (text == null) {
          throw new JudgeError(
            "validation",
            "judge response did not include text output",
            response.status,
          )
        }

        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(text)
        } catch (cause) {
          throw new JudgeError(
            "validation",
            "judge response text was not valid JSON",
            response.status,
            cause,
          )
        }

        const parsed = JudgeResponseSchema.safeParse(parsedJson)
        if (!parsed.success) {
          throw new JudgeError(
            "validation",
            `judge response failed schema validation: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
            response.status,
          )
        }

        const tokens = extractTokenCounts(payload)
        logger.info(
          `[search-eval] event=judge.call locale=${input.locale} verdict=${parsed.data.verdict} tokens.in=${tokens.input} tokens.out=${tokens.output} attempts=${attempt}`,
        )

        return {
          verdict: parsed.data.verdict,
          rationale: parsed.data.rationale,
          tokens,
          attempts: attempt,
          model,
        }
      }

      // Unreachable; the loop either returns or throws.
      throw new JudgeError(
        "retry_exhausted",
        `judge exhausted ${maxAttempts} attempts: ${failures.join(" | ")}`,
      )
    },
  }
}

function backoffMs(attempt: number): number {
  // Exponential with a small base — first retry ~500ms, second ~1s.
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_AFTER_CAP_MS)
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000)
  } catch {
    return `(unreadable body, status=${response.status})`
  }
}
