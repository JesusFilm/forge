import { z } from "zod"

import { getOpenRouterApiKey } from "../../config/env"
import {
  discardResponseBody,
  readResponseJsonCapped,
  readResponseTextCapped,
} from "./bounded-response"

/**
 * Shared OpenRouter JSON-mode chat helper for the devotional services
 * (hook picker, scripture selector, writer, safety gate). Mirrors the
 * `offline-search-eval/judge.ts` call shape — retry/backoff, JSON-schema
 * response format, typed errors — but generalized over an output schema so
 * each service supplies its own prompt and Zod shape.
 */

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"
/**
 * Bytes. The largest devotional call requests 1,400 output tokens; 256 KiB
 * budgets more than 180 encoded bytes per output token plus the small provider
 * envelope, including ample room for three-byte non-Latin structured output.
 */
export const DEVOTIONAL_LLM_MAX_RESPONSE_BYTES = 256 * 1024

export class DevotionalLlmError extends Error {
  constructor(
    readonly code:
      | "missing_credentials"
      | "transport"
      | "request_failed"
      | "validation",
    message: string,
    readonly cause?: unknown,
    /**
     * Upstream HTTP status when there was one, and whether an OUTER layer should
     * try again.
     *
     * `code` alone could not answer that: `request_failed` covered both a
     * permanent 400 (unsupported schema keyword, bad model id — identical on
     * every attempt) and a 429 that had already exhausted this client's own
     * retries. A caller reading only the code retried both, which turned three
     * critics behind their own single retry into up to eighteen requests, and
     * retried a deterministic 400 for nothing.
     *
     * This client OWNS the attempt budget: it retries 429/5xx up to
     * `maxAttempts` honouring Retry-After, and transport failures with backoff.
     * By the time it throws, that budget is spent, so no caller should add its
     * own — the three critics used to, which made a worst case of eighteen
     * requests for one gate. `status` is kept because it is the one thing a
     * caller genuinely needs and cannot recover: it tells an operator whether an
     * outage was a 429, a 500, or a permanent 400.
     */
    readonly status?: number,
  ) {
    super(message)
    this.name = "DevotionalLlmError"
  }
}

export type DevotionalLlmCompletion<TResult> = {
  system: string
  user: string
  /** JSON-schema sent to OpenRouter's structured-output `response_format`. */
  jsonSchema: { name: string; schema: Record<string, unknown> }
  /** Zod schema the parsed JSON must satisfy before it is returned. */
  schema: z.ZodType<TResult>
  maxTokens?: number
  temperature?: number
  /** Caller's cancellation. Combined with this client's own per-request timeout,
   *  and it also cuts the wait BETWEEN retries short — a cancelled workflow
   *  should not sit in a 30s backoff before noticing. */
  abortSignal?: AbortSignal
}

export type DevotionalLlm = {
  readonly model: string
  complete: <TResult>(
    input: DevotionalLlmCompletion<TResult>,
  ) => Promise<TResult>
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

export function createDevotionalLlm(options: {
  apiKey?: string
  model: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}): DevotionalLlm {
  const apiKey = options.apiKey ?? getOpenRouterApiKey()
  if (!apiKey) {
    throw new DevotionalLlmError(
      "missing_credentials",
      "OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY is required for devotional generation",
    )
  }
  const model = options.model
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

  return {
    model,
    async complete(input) {
      let response: Response | null = null
      let lastTransportError: unknown

      const aborted = () =>
        new DevotionalLlmError("transport", "request cancelled by caller")

      /** Wait, unless the caller cancels first. */
      async function backoff(ms: number): Promise<void> {
        if (!input.abortSignal) return sleep(ms)
        if (input.abortSignal.aborted) throw aborted()
        await Promise.race([
          sleep(ms),
          new Promise<never>((_resolve, reject) => {
            input.abortSignal?.addEventListener(
              "abort",
              () => reject(aborted()),
              { once: true },
            )
          }),
        ])
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Checked before EVERY attempt, not only before the first: a cancellation
        // that lands mid-backoff must not be followed by another request.
        if (input.abortSignal?.aborted) throw aborted()
        try {
          response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://mastra.jesusfilm.org",
              "X-OpenRouter-Title": "Forge Mastra Daily Devotional",
            },
            body: JSON.stringify({
              model,
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
              max_tokens: input.maxTokens ?? 1200,
              temperature: input.temperature ?? 0.4,
            }),
            signal: input.abortSignal
              ? AbortSignal.any([
                  input.abortSignal,
                  AbortSignal.timeout(timeoutMs),
                ])
              : AbortSignal.timeout(timeoutMs),
          })
        } catch (cause) {
          lastTransportError = cause
          if (attempt < maxAttempts) {
            await backoff(Math.min(500 * 2 ** (attempt - 1), 30_000))
            continue
          }
          throw new DevotionalLlmError(
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
          await discardResponseBody(response)
          await backoff(retryAfterMs(response, attempt))
          continue
        }
        break
      }

      if (response == null) {
        throw new DevotionalLlmError(
          "transport",
          lastTransportError instanceof Error
            ? lastTransportError.message
            : String(lastTransportError),
          lastTransportError,
        )
      }

      if (!response.ok) {
        // Capture a bounded slice of the body — OpenRouter returns the real
        // cause (unsupported response_format, bad model id, credit/limit) there;
        // status alone is rarely enough to diagnose.
        const body =
          (await readResponseTextCapped(
            response,
            DEVOTIONAL_LLM_MAX_RESPONSE_BYTES,
          )) ?? ""
        throw new DevotionalLlmError(
          "request_failed",
          `devotional model request failed with ${response.status}: ${body.slice(0, 500)}`,
          undefined,
          response.status,
        )
      }

      const payload = await readResponseJsonCapped(
        response,
        DEVOTIONAL_LLM_MAX_RESPONSE_BYTES,
      )
      if (payload === undefined) {
        throw new DevotionalLlmError(
          "validation",
          "devotional model response was not valid JSON",
        )
      }
      const text = extractText(payload)
      if (text == null) {
        throw new DevotionalLlmError(
          "validation",
          "devotional model response did not include text output",
        )
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(text)
      } catch {
        throw new DevotionalLlmError(
          "validation",
          "devotional model response text was not valid JSON",
        )
      }

      const parsed = input.schema.safeParse(parsedJson)
      if (!parsed.success) {
        throw new DevotionalLlmError(
          "validation",
          "devotional model response failed schema validation",
          parsed.error,
        )
      }
      return parsed.data
    },
  }
}
