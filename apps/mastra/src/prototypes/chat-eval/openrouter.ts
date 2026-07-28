/**
 * PROTOTYPE — local OpenRouter client for the chat-eval prototype.
 *
 * COPIED, NOT IMPORTED, from `src/services/devotional/llm.ts` — the repo's
 * copy-not-import convention for mechanical code (see the header of
 * `src/mastra/ai-chat-memory.ts` and
 * `docs/solutions/architecture-patterns/mastra-seed-baseline-portability-pattern.md`).
 *
 * Two reasons this is a copy rather than a reuse:
 *   1. `createDevotionalLlm` returns parsed JSON only. The answering model here
 *      produces PROSE, and the eval needs `finishReason`, token usage and
 *      latency — none of which that client exposes. Reusing it would mean
 *      changing its signature at seven call sites before we have learned
 *      anything.
 *   2. There are already seven near-identical copies of this fetch loop across
 *      apps/mastra + apps/admin. Consolidating them is real work with real
 *      risk; it is not a precondition for answering "does a quote-required
 *      judge work".
 *
 * Deliberate omission: the repo's buffered-response byte-cap law targets the
 * shared Node process that runs every Mastra agent/workflow. This is an
 * operator-run CLI in its own process, so the cap is omitted for brevity. The
 * real implementation must reinstate it.
 */

import { keyHelpText, resolveOpenRouterKey } from "./env"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"

export type Usage = { input: number; output: number }

export type TextCompletion = {
  text: string
  /** "stop" | "length" | provider-specific. "length" means truncated. */
  finishReason: string | null
  usage: Usage
  latencyMs: number
}

export type JsonSchemaSpec = {
  name: string
  schema: Record<string, unknown>
}

export class PrototypeLlmError extends Error {
  constructor(
    readonly code: "missing_credentials" | "transport" | "request_failed",
    message: string,
  ) {
    super(message)
    this.name = "PrototypeLlmError"
  }
}

export function getApiKey(): string {
  const resolved = resolveOpenRouterKey()
  if (!resolved) {
    throw new PrototypeLlmError("missing_credentials", keyHelpText())
  }
  return resolved.key
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function post(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ payload: unknown; latencyMs: number }> {
  const apiKey = getApiKey()
  const maxAttempts = 3
  const startedAt = Date.now()
  let lastError = "unknown"

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response
    try {
      response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://mastra.jesusfilm.org",
          "X-OpenRouter-Title": "Forge chat-eval prototype",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause)
      if (attempt < maxAttempts) {
        await sleep(Math.min(500 * 2 ** (attempt - 1), 8_000))
        continue
      }
      throw new PrototypeLlmError("transport", lastError)
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 400)
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxAttempts
      ) {
        await sleep(Math.min(1_000 * 2 ** (attempt - 1), 15_000))
        lastError = `${response.status}: ${detail}`
        continue
      }
      throw new PrototypeLlmError(
        "request_failed",
        `${response.status}: ${detail}`,
      )
    }

    return { payload: await response.json(), latencyMs: Date.now() - startedAt }
  }

  throw new PrototypeLlmError("transport", lastError)
}

function readChoice(payload: unknown): {
  content: string | null
  finishReason: string | null
} {
  if (payload == null || typeof payload !== "object") {
    return { content: null, finishReason: null }
  }
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: null, finishReason: null }
  }
  const choice = choices[0] as {
    message?: { content?: unknown }
    finish_reason?: unknown
  }
  const content = choice.message?.content
  return {
    content: typeof content === "string" ? content : null,
    finishReason:
      typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  }
}

function readUsage(payload: unknown): Usage {
  const usage =
    payload != null && typeof payload === "object"
      ? (payload as { usage?: unknown }).usage
      : null
  if (usage == null || typeof usage !== "object") return { input: 0, output: 0 }
  const record = usage as {
    prompt_tokens?: unknown
    completion_tokens?: unknown
  }
  return {
    input: typeof record.prompt_tokens === "number" ? record.prompt_tokens : 0,
    output:
      typeof record.completion_tokens === "number"
        ? record.completion_tokens
        : 0,
  }
}

/**
 * Prose completion. This is the shape `createDevotionalLlm` cannot produce and
 * the reason this file exists — `finishReason` in particular, because a
 * truncated answer must be reported as an ERROR, never scored as a bad answer.
 */
export async function completeText(input: {
  model: string
  system: string
  user: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<TextCompletion> {
  const { payload, latencyMs } = await post(
    {
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      // 1600, raised from 900 after the 2026-07-29 run truncated Sonnet on
      // q-trinity. The cap must sit well ABOVE the length we want answers to
      // hit, or the harness silently converts "too long" (a finding) into
      // "truncated" (an error) and we lose the signal.
      max_tokens: input.maxTokens ?? 1_600,
      temperature: input.temperature ?? 0.7,
    },
    input.timeoutMs ?? 90_000,
  )

  const { content, finishReason } = readChoice(payload)
  return {
    text: content ?? "",
    finishReason,
    usage: readUsage(payload),
    latencyMs,
  }
}

/**
 * Structured completion for the judge.
 *
 * NOTE (carried over from `safety-gate.ts`): Anthropic's structured-output
 * schema rejects numeric `minimum`/`maximum` and array `maxItems`. Keep those
 * out of any schema passed here — validate ranges after parsing instead.
 */
export async function completeJson<T>(input: {
  model: string
  system: string
  user: string
  jsonSchema: JsonSchemaSpec
  parse: (value: unknown) => T
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<{ value: T; usage: Usage; latencyMs: number }> {
  const { payload, latencyMs } = await post(
    {
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: input.jsonSchema.name,
          strict: true,
          schema: input.jsonSchema.schema,
        },
      },
      max_tokens: input.maxTokens ?? 2_000,
      temperature: input.temperature ?? 0,
    },
    input.timeoutMs ?? 90_000,
  )

  const { content } = readChoice(payload)
  if (content == null) {
    throw new PrototypeLlmError("request_failed", "no text in judge response")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new PrototypeLlmError(
      "request_failed",
      `judge response was not JSON: ${content.slice(0, 200)}`,
    )
  }
  return {
    value: input.parse(parsed),
    usage: readUsage(payload),
    latencyMs,
  }
}
