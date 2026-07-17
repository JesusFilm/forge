import { z } from "zod"

import { SubtitleProviderError } from "./types"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"
const OPENROUTER_REFERER = "https://mastra.jesusfilm.org"

export type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type OpenRouterUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type OpenRouterChatOptions<T> = {
  apiKey?: string
  model: string
  messages: ChatMessage[]
  timeoutMs: number
  fetchImpl?: typeof fetch
  responseFormat?: {
    name: string
    schema: Record<string, unknown>
    validator: z.ZodType<T>
  }
}

type RawOpenRouterResponse = {
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
  fetchImpl = fetch,
  responseFormat,
}: OpenRouterChatOptions<T>): Promise<OpenRouterChatResult<T>> {
  if (!apiKey) {
    throw new SubtitleProviderError(
      "provider_config_missing",
      false,
      "OpenRouter API key is not configured for subtitle enrichment",
    )
  }

  let response: Response
  try {
    response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
      },
      body: JSON.stringify({
        model,
        messages,
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
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new SubtitleProviderError(
      "provider_failed",
      true,
      "OpenRouter subtitle request failed",
      error,
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new SubtitleProviderError(
      "provider_auth_failed",
      false,
      "OpenRouter subtitle request was not authorized",
    )
  }

  if (!response.ok) {
    throw new SubtitleProviderError(
      "provider_failed",
      response.status >= 500 || response.status === 429,
      `OpenRouter subtitle request failed (${response.status})`,
    )
  }

  const raw = (await response.json().catch((error) => {
    throw new SubtitleProviderError(
      "provider_invalid_output",
      true,
      "OpenRouter subtitle response was not valid JSON",
      error,
    )
  })) as RawOpenRouterResponse

  const message = raw.choices?.[0]?.message
  if (message?.refusal) {
    throw new SubtitleProviderError(
      "provider_failed",
      false,
      "OpenRouter refused the subtitle request",
    )
  }

  if (typeof message?.content !== "string" || !message.content.trim()) {
    throw new SubtitleProviderError(
      "provider_invalid_output",
      true,
      "OpenRouter subtitle response was missing content",
    )
  }

  const value = responseFormat
    ? parseStructuredContent(message.content, responseFormat.validator)
    : (message.content as T)

  return {
    value,
    usage: usageFromResponse(raw),
  }
}
