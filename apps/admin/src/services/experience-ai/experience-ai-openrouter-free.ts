import { env } from "@/config/env"

export const DEFAULT_OPENROUTER_EXPERIENCE_CHAT_MODELS = [
  // Keep this list to free models/routers that advertise structured_outputs
  // support; the quality draft path asks OpenRouter for strict JSON schema.
  "nvidia/nemotron-3-super-120b-a12b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "openrouter/free",
] as const

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"

const OPENROUTER_EXPERIENCE_CHAT_TIMEOUT_MS = 45_000

export type OpenRouterChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type OpenRouterProviderAttempt = {
  model: string
  status: "succeeded" | "failed"
  usedModel?: string
  reason?: string
}

export type OpenRouterFreeResult<T> = {
  payload: T
  model: string
  usedModel: string
  attempts: OpenRouterProviderAttempt[]
}

export class OpenRouterFreeProviderError extends Error {
  constructor(
    readonly code:
      | "missing_provider"
      | "provider_rate_limited"
      | "upstream_error"
      | "validation_error"
      | "timeout",
    message: string,
    readonly attempts: OpenRouterProviderAttempt[] = [],
  ) {
    super(message)
    this.name = "OpenRouterFreeProviderError"
  }
}

function normalizeConfiguredModels(value: string): string[] {
  return value
    .split(",")
    .map((model) => model.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
}

export function openRouterExperienceChatModels(): string[] {
  if (env.OPENROUTER_EXPERIENCE_CHAT_MODELS) {
    return normalizeConfiguredModels(env.OPENROUTER_EXPERIENCE_CHAT_MODELS)
  }

  if (env.OPENROUTER_EXPERIENCE_CHAT_MODEL) {
    return normalizeConfiguredModels(env.OPENROUTER_EXPERIENCE_CHAT_MODEL)
  }

  return [...DEFAULT_OPENROUTER_EXPERIENCE_CHAT_MODELS]
}

function shouldTryNextModel(status: number, body: string): boolean {
  if (status === 404 || status === 429 || status >= 500) return true
  return /temporarily rate-limited|no endpoints available|no allowed providers/i.test(
    body,
  )
}

function isRateLimitFailure(value: string): boolean {
  return /status 429|rate-limited|rate limit/i.test(value)
}

function stripMarkdownFence(content: string) {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseProviderJson(content: string): unknown {
  const normalized = stripMarkdownFence(content)
  let parsed: unknown = JSON.parse(normalized)
  if (typeof parsed === "string")
    parsed = JSON.parse(stripMarkdownFence(parsed))
  return parsed
}

function extractOutputText(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return null
  const firstChoice = choices[0]
  if (firstChoice == null || typeof firstChoice !== "object") return null
  const message = (firstChoice as { message?: unknown }).message
  if (message == null || typeof message !== "object") return null
  const content = (message as { content?: unknown }).content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return null

  for (const part of content) {
    if (part == null || typeof part !== "object") continue
    const text = (part as { text?: unknown }).text
    if (typeof text === "string") return text
  }

  return null
}

function extractFinishReason(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return null
  const firstChoice = choices[0]
  if (firstChoice == null || typeof firstChoice !== "object") return null
  const reason = (firstChoice as { finish_reason?: unknown }).finish_reason
  return typeof reason === "string" ? reason : null
}

function extractUsedModel(payload: unknown, fallback: string): string {
  if (payload == null || typeof payload !== "object") return fallback
  const model = (payload as { model?: unknown }).model
  return typeof model === "string" && model.trim() ? model : fallback
}

function summarizeFailure(
  model: string,
  reason: string,
): OpenRouterProviderAttempt {
  return {
    model,
    status: "failed",
    reason: `${model}: ${reason}`.slice(0, 600),
  }
}

export async function generateOpenRouterFreeStructuredOutput<T>({
  messages,
  responseFormat,
  maxTokens = 4000,
  temperature = 0.35,
  validate,
  fetchImpl = fetch,
}: {
  messages: OpenRouterChatMessage[]
  responseFormat: unknown
  maxTokens?: number
  temperature?: number
  validate: (payload: unknown) => T
  fetchImpl?: typeof fetch
}): Promise<OpenRouterFreeResult<T>> {
  if (!env.OPENROUTER_API_KEY) {
    throw new OpenRouterFreeProviderError(
      "missing_provider",
      "OPENROUTER_API_KEY is required for quality-first generation",
    )
  }

  const models = openRouterExperienceChatModels()
  if (models.length === 0) {
    throw new OpenRouterFreeProviderError(
      "missing_provider",
      "No OpenRouter free models are configured",
    )
  }

  const attempts: OpenRouterProviderAttempt[] = []

  for (const [index, model] of models.entries()) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      OPENROUTER_EXPERIENCE_CHAT_TIMEOUT_MS,
    )

    try {
      const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://admin.jesusfilm.org",
          "X-OpenRouter-Title": "Forge Admin",
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: responseFormat,
          max_tokens: maxTokens,
          temperature,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const detail = errorBody.trim()
        attempts.push(
          summarizeFailure(
            model,
            `status ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`,
          ),
        )

        if (
          index < models.length - 1 &&
          shouldTryNextModel(response.status, detail)
        ) {
          continue
        }

        break
      }

      const responsePayload: unknown = await response.json()
      if (extractFinishReason(responsePayload) === "length") {
        attempts.push(summarizeFailure(model, "response was truncated"))
        if (index < models.length - 1) continue
        break
      }

      const outputText = extractOutputText(responsePayload)
      if (!outputText) {
        attempts.push(
          summarizeFailure(model, "response did not include text output"),
        )
        if (index < models.length - 1) continue
        break
      }

      let parsedJson: unknown
      try {
        parsedJson = parseProviderJson(outputText)
      } catch (error) {
        attempts.push(
          summarizeFailure(
            model,
            `response was not valid JSON${
              error instanceof Error ? ` (${error.message})` : ""
            }`,
          ),
        )
        if (index < models.length - 1) continue
        break
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
        attempts.push(
          summarizeFailure(
            model,
            `response validation failed${
              error instanceof Error ? ` (${error.message})` : ""
            }`,
          ),
        )
        if (index < models.length - 1) continue
        break
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError"
      attempts.push(
        summarizeFailure(
          model,
          isAbort
            ? `timed out after ${OPENROUTER_EXPERIENCE_CHAT_TIMEOUT_MS}ms`
            : error instanceof Error
              ? error.message
              : "provider request failed",
        ),
      )
      if (index < models.length - 1) continue
      throw new OpenRouterFreeProviderError(
        isAbort ? "timeout" : "upstream_error",
        `OpenRouter free generation failed after ${attempts.length} attempt(s)`,
        attempts,
      )
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  const failureText = attempts.map((attempt) => attempt.reason).join(" | ")
  if (
    attempts.length === models.length &&
    attempts.every((attempt) => isRateLimitFailure(attempt.reason ?? ""))
  ) {
    throw new OpenRouterFreeProviderError(
      "provider_rate_limited",
      `OpenRouter free generation was rate-limited after ${attempts.length} model attempt(s): ${failureText}`,
      attempts,
    )
  }

  throw new OpenRouterFreeProviderError(
    attempts.some((attempt) =>
      /validation|JSON|truncated/i.test(attempt.reason ?? ""),
    )
      ? "validation_error"
      : "upstream_error",
    `OpenRouter free generation failed after ${attempts.length} model attempt(s): ${failureText}`,
    attempts,
  )
}

export { OPENROUTER_EXPERIENCE_CHAT_TIMEOUT_MS }
