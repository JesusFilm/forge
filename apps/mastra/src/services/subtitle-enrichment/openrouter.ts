import { createHash } from "node:crypto"

import { z } from "zod"

import { SubtitleProviderError } from "./types"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"
const OPENROUTER_REFERER = "https://mastra.jesusfilm.org"
export const OPENROUTER_SUBTITLE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const OPENROUTER_SUBTITLE_TEMPERATURE = 0
export const OPENROUTER_SUBTITLE_MAX_OUTPUT_TOKENS = 4_096

export type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type OpenRouterUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type OpenRouterProviderCall = {
  status: "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT"
  requestDigest: string
  providerRequestId: string | null
  providerResponseId: string | null
  requestedModel: string
  resolvedModel: string | null
  usage: OpenRouterUsage | null
}

export type OpenRouterChatOptions<T> = {
  apiKey?: string
  model: string
  messages: ChatMessage[]
  timeoutMs: number
  deadlineAtMs?: number
  fetchImpl?: typeof fetch
  onUsage?: (usage: OpenRouterUsage) => void
  onUsageUnavailable?: () => void
  onProviderCall?: (call: OpenRouterProviderCall) => void
  responseFormat?: {
    name: string
    schema: Record<string, unknown>
    validator: z.ZodType<T>
  }
}

type RawOpenRouterResponse = {
  id?: unknown
  model?: unknown
  choices?: Array<{
    message?: {
      content?: unknown
      refusal?: unknown
    }
  }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
  }
}

export type OpenRouterChatResult<T> = {
  value: T
  usage: OpenRouterUsage
}

function usageFromResponse(response: RawOpenRouterResponse): OpenRouterUsage {
  return {
    promptTokens:
      typeof response.usage?.prompt_tokens === "number"
        ? response.usage.prompt_tokens
        : 0,
    completionTokens:
      typeof response.usage?.completion_tokens === "number"
        ? response.usage.completion_tokens
        : 0,
    totalTokens:
      typeof response.usage?.total_tokens === "number"
        ? response.usage.total_tokens
        : 0,
  }
}

function parseStructuredContent<T>(
  content: string,
  validator: z.ZodType<T>,
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new SubtitleProviderError(
      "provider_invalid_output",
      true,
      "OpenRouter returned non-JSON structured output",
      error,
    )
  }

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed)
    } catch (error) {
      throw new SubtitleProviderError(
        "provider_invalid_output",
        true,
        "OpenRouter returned double-encoded invalid structured output",
        error,
      )
    }
  }

  const result = validator.safeParse(parsed)
  if (!result.success) {
    throw new SubtitleProviderError(
      "provider_invalid_output",
      true,
      "OpenRouter structured output failed validation",
      result.error,
    )
  }

  return result.data
}

export async function requestOpenRouterChat<T = string>({
  apiKey,
  model,
  messages,
  timeoutMs,
  deadlineAtMs,
  fetchImpl = fetch,
  onUsage,
  onUsageUnavailable,
  onProviderCall,
  responseFormat,
}: OpenRouterChatOptions<T>): Promise<OpenRouterChatResult<T>> {
  if (!apiKey) {
    throw new SubtitleProviderError(
      "provider_config_missing",
      false,
      "OpenRouter API key is not configured for subtitle enrichment",
    )
  }

  let usageCoverageSettled = false
  const reportUsage = (usage: OpenRouterUsage) => {
    if (usageCoverageSettled) return
    usageCoverageSettled = true
    onUsage?.(usage)
  }
  const reportUsageUnavailable = () => {
    if (usageCoverageSettled) return
    usageCoverageSettled = true
    onUsageUnavailable?.()
  }

  const requestBody = JSON.stringify({
    model,
    messages,
    temperature: OPENROUTER_SUBTITLE_TEMPERATURE,
    max_tokens: OPENROUTER_SUBTITLE_MAX_OUTPUT_TOKENS,
    ...(responseFormat
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: responseFormat.name,
              strict: true,
              schema: responseFormat.schema,
            },
          },
          plugins: [{ id: "response-healing" }],
        }
      : {}),
  })
  const requestDigest = createHash("sha256").update(requestBody).digest("hex")
  let providerCallSettled = false
  const settleProviderCall = (
    status: OpenRouterProviderCall["status"],
    identity: {
      providerRequestId?: string | null
      providerResponseId?: string | null
      resolvedModel?: string | null
      usage?: OpenRouterUsage | null
    } = {},
  ) => {
    if (providerCallSettled) return
    providerCallSettled = true
    try {
      onProviderCall?.({
        status,
        requestDigest,
        providerRequestId: identity.providerRequestId ?? null,
        providerResponseId: identity.providerResponseId ?? null,
        requestedModel: model,
        resolvedModel: identity.resolvedModel ?? null,
        usage: identity.usage ?? null,
      })
    } catch {
      // Telemetry must never change provider execution behavior.
    }
  }

  let response: Response
  const remainingMs =
    deadlineAtMs == null
      ? timeoutMs
      : Math.min(timeoutMs, deadlineAtMs - Date.now())
  if (remainingMs <= 0) {
    reportUsageUnavailable()
    settleProviderCall("FAILED")
    throw new SubtitleProviderError(
      "provider_failed",
      true,
      "Subtitle evaluation cell deadline expired",
    )
  }
  try {
    response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
      },
      body: requestBody,
      signal: AbortSignal.timeout(Math.max(1, remainingMs)),
    })
  } catch (error) {
    reportUsageUnavailable()
    settleProviderCall("FAILED")
    throw new SubtitleProviderError(
      "provider_failed",
      true,
      "OpenRouter subtitle request failed",
      error,
    )
  }

  const responseGenerationId = boundedProviderIdentity(
    response.headers.get("X-Generation-Id"),
    191,
  )

  if (response.status === 401 || response.status === 403) {
    reportUsageUnavailable()
    settleProviderCall("FAILED", { providerResponseId: responseGenerationId })
    throw new SubtitleProviderError(
      "provider_auth_failed",
      false,
      "OpenRouter subtitle request was not authorized",
    )
  }

  if (!response.ok) {
    reportUsageUnavailable()
    settleProviderCall("FAILED", { providerResponseId: responseGenerationId })
    throw new SubtitleProviderError(
      "provider_failed",
      response.status >= 500 || response.status === 429,
      `OpenRouter subtitle request failed (${response.status})`,
    )
  }

  let raw: RawOpenRouterResponse
  try {
    raw = (await readBoundedResponseJson(
      response,
      OPENROUTER_SUBTITLE_MAX_RESPONSE_BYTES,
    )) as RawOpenRouterResponse
  } catch (error) {
    reportUsageUnavailable()
    settleProviderCall("INVALID_OUTPUT", {
      providerResponseId: responseGenerationId,
    })
    throw error
  }
  const usage = usageFromResponse(raw)
  const completeUsage = hasCompleteUsage(raw)
  if (completeUsage) {
    reportUsage(usage)
  } else {
    reportUsageUnavailable()
  }

  const providerResponseId =
    responseGenerationId ?? boundedProviderIdentity(raw.id, 191)
  const resolvedModel = boundedProviderIdentity(raw.model, 160)

  const message = raw.choices?.[0]?.message
  if (message?.refusal) {
    settleProviderCall("FAILED", {
      providerRequestId: null,
      providerResponseId,
      resolvedModel,
      usage: completeUsage ? usage : null,
    })
    throw new SubtitleProviderError(
      "provider_failed",
      false,
      "OpenRouter refused the subtitle request",
    )
  }

  if (typeof message?.content !== "string" || !message.content.trim()) {
    settleProviderCall("INVALID_OUTPUT", {
      providerRequestId: null,
      providerResponseId,
      resolvedModel,
      usage: completeUsage ? usage : null,
    })
    throw new SubtitleProviderError(
      "provider_invalid_output",
      true,
      "OpenRouter subtitle response was missing content",
    )
  }

  let value: T
  try {
    value = responseFormat
      ? parseStructuredContent(message.content, responseFormat.validator)
      : (message.content as T)
  } catch (error) {
    settleProviderCall("INVALID_OUTPUT", {
      providerRequestId: null,
      providerResponseId,
      resolvedModel,
      usage: completeUsage ? usage : null,
    })
    throw error
  }

  settleProviderCall("SUCCEEDED", {
    providerRequestId: null,
    providerResponseId,
    resolvedModel,
    usage: completeUsage ? usage : null,
  })

  return {
    value,
    usage,
  }
}

function boundedProviderIdentity(
  value: unknown,
  maximumLength: number,
): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0)!
      return codePoint <= 31 || codePoint === 127
    })
  ) {
    return null
  }
  return normalized
}

function hasCompleteUsage(response: RawOpenRouterResponse): boolean {
  return (
    typeof response.usage?.prompt_tokens === "number" &&
    typeof response.usage.completion_tokens === "number" &&
    typeof response.usage.total_tokens === "number"
  )
}

async function readBoundedResponseJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw responseTooLargeError()
  }
  if (!response.body) {
    throw invalidJsonError(new Error("OpenRouter response body was empty"))
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw responseTooLargeError()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    throw invalidJsonError(error)
  }
}

function responseTooLargeError(): SubtitleProviderError {
  return new SubtitleProviderError(
    "provider_invalid_output",
    true,
    "OpenRouter subtitle response exceeded its byte ceiling",
  )
}

function invalidJsonError(cause: unknown): SubtitleProviderError {
  return new SubtitleProviderError(
    "provider_invalid_output",
    true,
    "OpenRouter subtitle response was not valid JSON",
    cause,
  )
}

export const _internals = { readBoundedResponseJson }
