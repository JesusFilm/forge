/**
 * Seeker eval — local OpenRouter client (ported from the chat-eval prototype).
 *
 * COPIED, NOT IMPORTED, from `src/services/devotional/llm.ts` — the repo's
 * copy-not-import convention for mechanical code (see the header of
 * `src/mastra/ai-chat-memory.ts`).
 *
 * Two reasons this is a copy rather than a reuse:
 *   1. `createDevotionalLlm` returns parsed JSON only. The answering model
 *      here produces PROSE, and the eval needs `finishReason`, token usage
 *      and latency — none of which that client exposes.
 *   2. The eval must be able to run against a DEDICATED key
 *      (`CHAT_EVAL_OPENROUTER_API_KEY`, and only that key) with its own
 *      spend guard, which the shared clients deliberately do not have.
 *
 * Changes from the prototype copy:
 *   - The buffered-response byte-cap law is REINSTATED (the prototype omitted
 *     it "for brevity"): both the success-path JSON read and the error-path
 *     text read go through `read-body.ts`'s capped readers.
 *   - `completeText` and `completeWithTools` are dropped. The live tool loop
 *     runs through the REAL agent (built later by the loop runner on Lane 2's
 *     `buildSeekerAgent` seam), not through this copied client; the injected
 *     fast mode and the judge are the only consumers left here.
 *   - `fetchImpl` is injectable so tests can prove the fail-before-spending
 *     mechanism (a missing key must throw BEFORE any fetch happens).
 */

import {
  keyHelpText,
  resolveMaxResponseBytes,
  resolveOpenRouterKey,
} from "./env"
import { readJsonBodyCapped, readTextBodyCapped } from "./read-body"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"

/** Cap on the error-path detail read — a diagnostic string, never a payload. */
const MAX_ERROR_DETAIL_BYTES = 16 * 1024

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

export class EvalLlmError extends Error {
  constructor(
    readonly code: "missing_credentials" | "transport" | "request_failed",
    message: string,
  ) {
    super(message)
    this.name = "EvalLlmError"
  }
}

export function getApiKey(): string {
  const resolved = resolveOpenRouterKey()
  if (!resolved) {
    throw new EvalLlmError("missing_credentials", keyHelpText())
  }
  return resolved.key
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function post(
  body: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ payload: unknown; latencyMs: number }> {
  // Key resolution FIRST — a missing key must throw before any network call,
  // so an unprovisioned operator can never spend against a sibling credential.
  const apiKey = getApiKey()
  const maxResponseBytes = resolveMaxResponseBytes()
  const maxAttempts = 3
  const startedAt = Date.now()
  let lastError = "unknown"

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response
    try {
      response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://mastra.jesusfilm.org",
          "X-OpenRouter-Title": "Forge seeker eval",
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
      throw new EvalLlmError("transport", lastError)
    }

    if (!response.ok) {
      const detail = (
        (await readTextBodyCapped(response, MAX_ERROR_DETAIL_BYTES)) ?? ""
      ).slice(0, 400)
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxAttempts
      ) {
        await sleep(Math.min(1_000 * 2 ** (attempt - 1), 15_000))
        lastError = `${response.status}: ${detail}`
        continue
      }
      throw new EvalLlmError("request_failed", `${response.status}: ${detail}`)
    }

    const payload = await readJsonBodyCapped(response, maxResponseBytes)
    if (payload === undefined) {
      // Over-cap or non-JSON body. The capped reader already aborted the
      // socket; surface it as a request failure without echoing any body.
      throw new EvalLlmError(
        "request_failed",
        "response body exceeded the byte cap or was not valid JSON",
      )
    }
    return { payload, latencyMs: Date.now() - startedAt }
  }

  throw new EvalLlmError("transport", lastError)
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
 * Decoding parameters for the INJECTED FAST MODE ONLY (run-answers +
 * this client's completions), exported so run identity can stamp them — a
 * temperature change breaks run comparability. Decision 2026-08-04 (#14):
 * the GATING tool-loop mode (run-loop.ts) no longer pins these — it samples
 * provider defaults exactly like production, and stamps `decoding: null` in
 * run identity so pinned-era artifacts can never silently compare against
 * provider-default runs.
 * 1600, raised from 900 after the 2026-07-29 prototype run truncated Sonnet
 * on q-trinity: the cap must sit well ABOVE the length we want answers to
 * hit, or the harness silently converts "too long" (a finding) into
 * "truncated" (an error) and loses the signal.
 */
export const ANSWER_DECODING = { temperature: 0.7, maxTokens: 1_600 } as const

/**
 * Retrieval already done, handed to the model as a completed tool exchange.
 * THIS IS THE INJECTED FAST MODE.
 *
 * We fix the query (it is the eval question, verbatim), we fix the passages
 * (captured once, committed), and we present the exchange as though the tool
 * had already run. The model's only job is to answer from what it was given.
 *
 * The message SEQUENCE is still exactly what a real tool call produces — an
 * assistant turn carrying `tool_calls`, then a `tool` turn with the matching
 * `tool_call_id`. Passages are never pasted into the prompt as prose, because
 * models treat tool output differently from instructions.
 *
 * `tool_choice: "none"` on the final turn forces a text answer. The cost:
 * this mode cannot observe whether a model WOULD have called the tool. That
 * is a real property — gemma-26b skips it — and it belongs to the loop
 * runner (the gate), not this non-gating fast mode.
 */
export async function completeWithInjectedTool(input: {
  model: string
  system: string
  user: string
  toolSpec: { function: { name: string } }
  /** The query we searched with — the eval question, verbatim. */
  query: string
  /** What the tool returned for that query. */
  toolResult: unknown
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<TextCompletion> {
  const toolCallId = `call_${input.toolSpec.function.name}_eval`
  const messages = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: toolCallId,
          type: "function",
          function: {
            name: input.toolSpec.function.name,
            arguments: JSON.stringify({ query: input.query }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify(input.toolResult),
    },
  ]

  const { payload, latencyMs } = await post(
    {
      model: input.model,
      messages,
      tools: [input.toolSpec],
      tool_choice: "none",
      max_tokens: input.maxTokens ?? ANSWER_DECODING.maxTokens,
      temperature: input.temperature ?? ANSWER_DECODING.temperature,
    },
    input.timeoutMs ?? 90_000,
    input.fetchImpl,
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
  fetchImpl?: typeof fetch
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
    input.fetchImpl,
  )

  const { content } = readChoice(payload)
  if (content == null) {
    throw new EvalLlmError("request_failed", "no text in judge response")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new EvalLlmError(
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
