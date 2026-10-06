import { createOpenAI } from "@ai-sdk/openai"
import { generateText, Output } from "ai"
import { z } from "zod"

import { getOpenRouterApiKey } from "../../config/env"

export const PRECOMPUTED_MODEL_ID = "gpt-6-astra"

export class AstraAccessError extends Error {
  constructor() {
    super("Astra project or model access is unavailable")
  }
}

export function isAstraAccessFailure(error: unknown): boolean {
  if (error instanceof AstraAccessError) return true
  if (typeof error !== "object" || error === null) return false
  const candidate = error as {
    statusCode?: unknown
    status?: unknown
    code?: unknown
    name?: unknown
  }
  const status = candidate.statusCode ?? candidate.status
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    candidate.code === "model_not_found" ||
    candidate.code === "model_not_available" ||
    candidate.name === "NoSuchModelError"
  )
}

export type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
}

export type StructuredModel = {
  generate<T extends z.ZodType>(input: {
    schema: T
    system: string
    prompt: string
    maxOutputTokens: number
  }): Promise<{ output: z.output<T>; usage: ModelUsage }>
}

/** Exact Astra model through OpenRouter Responses; no model/provider fallback. */
export function createAstraModel(
  apiKey: string | undefined = getOpenRouterApiKey(),
): StructuredModel {
  if (!apiKey) {
    throw new AstraAccessError()
  }
  const openrouter = createOpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    name: "openrouter",
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        redirect: "error",
        body: JSON.stringify({
          ...JSON.parse(String(init?.body)),
          provider: { require_parameters: true, allow_fallbacks: false },
        }),
      }),
  })
  return {
    async generate<T extends z.ZodType>({
      schema,
      system,
      prompt,
      maxOutputTokens,
    }: {
      schema: T
      system: string
      prompt: string
      maxOutputTokens: number
    }) {
      const result = await generateText({
        model: openrouter.responses(`openai/${PRECOMPUTED_MODEL_ID}`),
        system,
        prompt,
        output: Output.object({ schema }),
        maxOutputTokens,
        // One recorded call means one adapter HTTP request. Any future
        // retry must have a distinct call ID and usage record.
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(120_000),
      })
      return {
        // The caller validates after capturing usage, so a returned but
        // malformed object still contributes its reported tokens.
        output: result.output as z.output<T>,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens,
        },
      }
    },
  }
}
