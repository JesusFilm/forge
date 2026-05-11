/**
 * Ollama provider adapter for the Experience AI chat surface.
 *
 * Peer of `experience-ai-openrouter-free.ts`. The local Ollama HTTP API
 * (`POST /api/chat`) exposes two shapes used by this file:
 *   - `stream: false, format: "json"` for the quality-draft path: returns a
 *     single JSON envelope `{message:{content:string}, done:true, model, …}`.
 *   - `stream: true, format: "json"` for the chat-turn path: returns an
 *     NDJSON stream of `{message:{content:string|null}, done:boolean, …}`
 *     chunks terminating with `done: true`.
 *
 * Errors are typed via `OllamaProviderError` and map onto the same
 * `ChatErrorCode` literals the OpenRouter adapter uses, so the chat
 * service can surface either provider through a uniform error path.
 *
 * Auth posture: Ollama is unauthenticated locally; no API key. Configure
 * via `OLLAMA_BASE_URL` (default `http://localhost:11434`) and
 * `OLLAMA_CHAT_MODEL` (default `gemma4:e4b`).
 */

import { env } from "@/config/env"

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
const DEFAULT_OLLAMA_CHAT_MODEL = "gemma4:e4b"

export const OLLAMA_CHAT_STRUCTURED_TIMEOUT_MS = 60_000
export const OLLAMA_CHAT_STREAM_IDLE_TIMEOUT_MS = 120_000
export const OLLAMA_CHAT_STREAM_TOTAL_TIMEOUT_MS = 180_000

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type OllamaProviderAttempt = {
  model: string
  status: "succeeded" | "failed"
  usedModel?: string
  reason?: string
}

export type OllamaStructuredResult<T> = {
  payload: T
  model: string
  usedModel: string
  attempts: OllamaProviderAttempt[]
}

export type OllamaProviderErrorCode =
  | "missing_provider"
  | "upstream_error"
  | "validation_error"
  | "timeout"

export class OllamaProviderError extends Error {
  constructor(
    readonly code: OllamaProviderErrorCode,
    message: string,
    readonly attempts: OllamaProviderAttempt[] = [],
  ) {
    super(message)
    this.name = "OllamaProviderError"
  }
}

function ollamaBaseUrl(): string {
  return (env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "")
}

export function ollamaChatModel(): string {
  return env.OLLAMA_CHAT_MODEL ?? DEFAULT_OLLAMA_CHAT_MODEL
}

function ollamaChatEndpoint(): string {
  return new URL("api/chat", `${ollamaBaseUrl()}/`).toString()
}

function stripMarkdownFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseProviderJson(content: string): unknown {
  const normalized = stripMarkdownFence(content)
  let parsed: unknown = JSON.parse(normalized)
  if (typeof parsed === "string") {
    parsed = JSON.parse(stripMarkdownFence(parsed))
  }
  return parsed
}

function extractStructuredContent(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const message = (payload as { message?: unknown }).message
  if (message == null || typeof message !== "object") return null
  const content = (message as { content?: unknown }).content
  return typeof content === "string" ? content : null
}

function extractUsedModel(payload: unknown, fallback: string): string {
  if (payload == null || typeof payload !== "object") return fallback
  const model = (payload as { model?: unknown }).model
  return typeof model === "string" && model.trim() ? model : fallback
}

/**
 * Single-shot, validated, structured-output call to Ollama. Mirrors the
 * shape of `generateOpenRouterFreeStructuredOutput` so the quality-draft
 * caller can branch on `ChatProvider` without a wrapping abstraction.
 */
export async function generateOllamaStructuredOutput<T>({
  messages,
  temperature = 0.35,
  numPredict = 4000,
  validate,
  fetchImpl = fetch,
  signal,
}: {
  messages: OllamaChatMessage[]
  temperature?: number
  numPredict?: number
  validate: (payload: unknown) => T
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<OllamaStructuredResult<T>> {
  const model = ollamaChatModel()
  const attempts: OllamaProviderAttempt[] = []
  const endpoint = ollamaChatEndpoint()

  const timeoutController = new AbortController()
  const timer = setTimeout(
    () => timeoutController.abort(),
    OLLAMA_CHAT_STRUCTURED_TIMEOUT_MS,
  )

  const signals: AbortSignal[] = [timeoutController.signal]
  if (signal) signals.push(signal)
  // Older Node lacks AbortSignal.any; fall back to a manual merge.
  const mergedSignal =
    typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal })
      .any === "function"
      ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any(
          signals,
        )
      : timeoutController.signal

  try {
    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          format: "json",
          options: {
            temperature,
            num_predict: numPredict,
          },
        }),
        signal: mergedSignal,
      })
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError"
      const reason = isAbort
        ? `timed out after ${OLLAMA_CHAT_STRUCTURED_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : "provider request failed"
      attempts.push({ model, status: "failed", reason: `${model}: ${reason}` })

      // ECONNREFUSED / ENOTFOUND etc. surface as `TypeError: fetch failed`.
      if (
        !isAbort &&
        error instanceof Error &&
        /fetch failed|ECONNREFUSED|ENOTFOUND|not configured/i.test(error.message)
      ) {
        throw new OllamaProviderError(
          "missing_provider",
          `Ollama is not reachable at ${endpoint}: ${error.message}`,
          attempts,
        )
      }

      throw new OllamaProviderError(
        isAbort ? "timeout" : "upstream_error",
        `Ollama generation failed: ${reason}`,
        attempts,
      )
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "")
      const detail = errorBody.trim().slice(0, 500)
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: status ${response.status}${detail ? `: ${detail}` : ""}`,
      })
      throw new OllamaProviderError(
        "upstream_error",
        `Ollama generation failed with status ${response.status}`,
        attempts,
      )
    }

    const responsePayload: unknown = await response.json()
    const outputText = extractStructuredContent(responsePayload)
    if (!outputText) {
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: response did not include message.content`,
      })
      throw new OllamaProviderError(
        "validation_error",
        "Ollama response did not include message.content",
        attempts,
      )
    }

    let parsedJson: unknown
    try {
      parsedJson = parseProviderJson(outputText)
    } catch (error) {
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: response was not valid JSON${
          error instanceof Error ? ` (${error.message})` : ""
        }`,
      })
      throw new OllamaProviderError(
        "validation_error",
        `Ollama response was not valid JSON${
          error instanceof Error ? `: ${error.message}` : ""
        }`,
        attempts,
      )
    }

    try {
      const payload = validate(parsedJson)
      const usedModel = extractUsedModel(responsePayload, model)
      return {
        payload,
        model,
        usedModel,
        attempts: [...attempts, { model, usedModel, status: "succeeded" }],
      }
    } catch (error) {
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: response validation failed${
          error instanceof Error ? ` (${error.message})` : ""
        }`,
      })
      throw new OllamaProviderError(
        "validation_error",
        `Ollama response failed schema validation${
          error instanceof Error ? `: ${error.message}` : ""
        }`,
        attempts,
      )
    }
  } finally {
    clearTimeout(timer)
  }
}

// -----------------------------------------------------------------------------
// Streaming chat-turn — used by the chat service in place of `runCodexChat`.
// -----------------------------------------------------------------------------

import type { ChatErrorCode } from "./experience-ai-chat-error-codes"

export type OllamaRunResult =
  | { kind: "envelope"; raw: unknown }
  | { kind: "error"; code: ChatErrorCode; message: string }

type OllamaStreamChunk = {
  message?: { content?: unknown } | null
  done?: boolean
  error?: string
}

function parseStreamLine(line: string): OllamaStreamChunk | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed === "[DONE]") return null
  try {
    return JSON.parse(trimmed) as OllamaStreamChunk
  } catch {
    return null
  }
}

/**
 * Stream a chat turn from Ollama and resolve with the parsed JSON envelope
 * once `done: true` arrives. Mirrors the discriminated return of
 * `runCodexChat` so the chat service can union them.
 *
 * Behavior:
 * - Forwards `abortSignal` so the caller can cancel mid-flight.
 * - Calls `onToken(text)` for each non-empty content chunk so the SSE
 *   route can stream `token_delta` events to the client.
 * - Total run is bounded by `OLLAMA_CHAT_STREAM_TOTAL_TIMEOUT_MS`; idle
 *   time between chunks is bounded by
 *   `OLLAMA_CHAT_STREAM_IDLE_TIMEOUT_MS`.
 */
export async function runOllamaChat({
  prompt,
  abortSignal,
  onToken,
  fetchImpl = fetch,
}: {
  prompt: string
  abortSignal?: AbortSignal
  onToken: (text: string) => void
  fetchImpl?: typeof fetch
}): Promise<OllamaRunResult> {
  const model = ollamaChatModel()
  const endpoint = ollamaChatEndpoint()

  const controller = new AbortController()
  const onUpstreamAbort = () => controller.abort()
  abortSignal?.addEventListener("abort", onUpstreamAbort, { once: true })

  const totalTimer = setTimeout(() => {
    controller.abort()
  }, OLLAMA_CHAT_STREAM_TOTAL_TIMEOUT_MS)

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      controller.abort()
    }, OLLAMA_CHAT_STREAM_IDLE_TIMEOUT_MS)
  }

  try {
    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          format: "json",
        }),
        signal: controller.signal,
      })
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError"
      if (isAbort && abortSignal?.aborted) {
        return { kind: "error", code: "cancelled", message: "Run cancelled" }
      }
      if (isAbort) {
        return {
          kind: "error",
          code: "provider_timeout",
          message: `Ollama did not respond within ${OLLAMA_CHAT_STREAM_TOTAL_TIMEOUT_MS}ms`,
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
        return {
          kind: "error",
          code: "provider_not_configured",
          message: `Ollama is not reachable at ${endpoint}: ${message}`,
        }
      }
      return {
        kind: "error",
        code: "provider_unavailable",
        message: `Ollama request failed: ${message}`,
      }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      return {
        kind: "error",
        code: "provider_unavailable",
        message: `Ollama responded with status ${response.status}${
          body ? `: ${body.slice(0, 300)}` : ""
        }`,
      }
    }

    if (!response.body) {
      return {
        kind: "error",
        code: "provider_unavailable",
        message: "Ollama response had no body",
      }
    }

    resetIdleTimer()

    const reader = response.body.getReader()
    const decoder = new TextDecoder("utf-8")
    let lineBuffer = ""
    let accumulated = ""
    let upstreamError: string | null = null

    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError"
        if (isAbort && abortSignal?.aborted) {
          return { kind: "error", code: "cancelled", message: "Run cancelled" }
        }
        if (isAbort) {
          return {
            kind: "error",
            code: "provider_timeout",
            message: "Ollama stream timed out",
          }
        }
        return {
          kind: "error",
          code: "provider_unavailable",
          message: error instanceof Error ? error.message : String(error),
        }
      }

      if (chunk.done) break
      resetIdleTimer()
      lineBuffer += decoder.decode(chunk.value, { stream: true })

      let newlineIndex = lineBuffer.indexOf("\n")
      while (newlineIndex !== -1) {
        const line = lineBuffer.slice(0, newlineIndex)
        lineBuffer = lineBuffer.slice(newlineIndex + 1)
        const parsed = parseStreamLine(line)
        newlineIndex = lineBuffer.indexOf("\n")
        if (!parsed) continue

        if (typeof parsed.error === "string" && parsed.error.trim()) {
          upstreamError = parsed.error
          continue
        }

        const content = parsed.message?.content
        if (typeof content === "string" && content.length > 0) {
          accumulated += content
          onToken(content)
        }

        if (parsed.done === true) {
          // Continue draining; the final envelope is the accumulated body.
        }
      }
    }

    // Drain trailing buffered content.
    const tail = lineBuffer.trim()
    if (tail.length > 0) {
      const parsed = parseStreamLine(tail)
      if (parsed) {
        if (typeof parsed.error === "string" && parsed.error.trim()) {
          upstreamError = parsed.error
        } else {
          const content = parsed.message?.content
          if (typeof content === "string" && content.length > 0) {
            accumulated += content
            onToken(content)
          }
        }
      }
    }

    if (upstreamError) {
      return {
        kind: "error",
        code: "provider_unavailable",
        message: `Ollama reported an error mid-stream: ${upstreamError}`,
      }
    }

    if (accumulated.length === 0) {
      return {
        kind: "error",
        code: "empty_response",
        message: "Ollama stream produced no content",
      }
    }

    let raw: unknown
    try {
      raw = JSON.parse(stripMarkdownFence(accumulated))
    } catch (error) {
      return {
        kind: "error",
        code: "invalid_json",
        message: `Ollama final body was not valid JSON${
          error instanceof Error ? `: ${error.message}` : ""
        }`,
      }
    }

    return { kind: "envelope", raw }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    clearTimeout(totalTimer)
    abortSignal?.removeEventListener("abort", onUpstreamAbort)
  }
}
