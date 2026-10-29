import { z } from "zod"
import { getOpenRouterApiKey } from "../../config/env"
import {
  EnrichmentSettledError,
  enrichmentProviderFetch,
  markEnrichmentSpendAmbiguous,
} from "./provider-spend"

export const DEFAULT_MODEL = "google/gemini-2.5-flash"
type Message = {
  role: "system" | "user" | "assistant"
  content:
    | string
    | (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[]
}
export async function createStructuredOpenrouterOutput<T>(input: {
  context: string
  name: string
  schema: z.ZodType<T>
  jsonSchema: Record<string, unknown>
  messages: Message[]
  model?: string
  onUsage?: (usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }) => void
}): Promise<T> {
  const apiKey = getOpenRouterApiKey()
  if (!apiKey) throw new EnrichmentSettledError("OpenRouter is not configured")
  const response = await enrichmentProviderFetch(
    fetch,
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model ?? DEFAULT_MODEL,
        messages: input.messages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: input.name,
            strict: true,
            schema: input.jsonSchema,
          },
        },
        plugins: [{ id: "response-healing" }],
      }),
    },
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new EnrichmentSettledError(
      `Structured output request failed for ${input.context}: ${response.status}`,
    )
  }
  const reader = response.body?.getReader()
  if (!reader) throw new EnrichmentSettledError("Provider response is empty")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2 * 1024 * 1024) {
        await reader.cancel()
        throw new EnrichmentSettledError("Provider response too large")
      }
      chunks.push(value)
    }
  } catch (error) {
    markEnrichmentSpendAmbiguous()
    throw error
  }
  const raw = z
    .object({
      choices: z.array(
        z.object({
          message: z.object({
            content: z.string().nullable().optional(),
            refusal: z.string().nullable().optional(),
          }),
        }),
      ),
      usage: z
        .object({
          prompt_tokens: z.number(),
          completion_tokens: z.number(),
          total_tokens: z.number(),
        })
        .optional(),
    })
    .parse(JSON.parse(Buffer.concat(chunks).toString()))
  if (raw.usage)
    input.onUsage?.({
      promptTokens: raw.usage.prompt_tokens,
      completionTokens: raw.usage.completion_tokens,
      totalTokens: raw.usage.total_tokens,
    })
  const message = raw.choices[0]?.message
  if (message?.refusal)
    throw new EnrichmentSettledError(
      `Structured output request refused for ${input.context}`,
    )
  if (!message?.content?.trim())
    throw new EnrichmentSettledError(
      `Structured output missing content for ${input.context}`,
    )
  let content: unknown
  try {
    content = JSON.parse(message.content)
    if (typeof content === "string") content = JSON.parse(content)
  } catch {
    throw new EnrichmentSettledError(
      `Structured output parsing failed for ${input.context}`,
    )
  }
  const parsed = input.schema.safeParse(content)
  if (!parsed.success)
    throw new EnrichmentSettledError(
      `Structured output validation failed for ${input.context}`,
    )
  return parsed.data
}
