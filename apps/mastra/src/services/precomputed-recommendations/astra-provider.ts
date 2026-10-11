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
  /** Actual provider-reported charge; absent when the provider omits it. */
  costUsd?: number
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
      let providerUsage: ModelUsage = {}
      const openrouter = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        name: "openrouter",
        fetch: async (url, init) => {
          const response = await fetch(url, {
            ...init,
            redirect: "error",
            body: JSON.stringify({
              ...JSON.parse(String(init?.body)),
              provider: { require_parameters: true, allow_fallbacks: false },
            }),
          })
          // AI SDK exposes token usage but drops OpenRouter's usage.cost.
          // Read only the provider usage from a clone, including when the
          // structured-output parser rejects an otherwise charged response.
          const body: unknown = await response
            .clone()
            .json()
            .catch(() => null)
          if (typeof body === "object" && body !== null && "usage" in body) {
            const usage = body.usage
            if (typeof usage === "object" && usage !== null) {
              const candidate = usage as Record<string, unknown>
              const token = (value: unknown) =>
                Number.isSafeInteger(value) && Number(value) >= 0
                  ? Number(value)
                  : undefined
              const cost = candidate.cost
              providerUsage = {
                inputTokens: token(candidate.input_tokens),
                outputTokens: token(candidate.output_tokens),
                cachedInputTokens:
                  typeof candidate.input_tokens_details === "object" &&
                  candidate.input_tokens_details !== null &&
                  "cached_tokens" in candidate.input_tokens_details
                    ? token(candidate.input_tokens_details.cached_tokens)
                    : undefined,
                costUsd:
                  typeof cost === "number" && Number.isFinite(cost) && cost >= 0
                    ? cost
                    : undefined,
              }
            }
          }
          return response
        },
      })
      try {
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
          output: result.output as z.output<T>,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens,
            costUsd: providerUsage.costUsd,
          },
        }
      } catch (error) {
        if (error instanceof Error) {
          const reported =
            "usage" in error &&
            typeof error.usage === "object" &&
            error.usage !== null
              ? (error.usage as ModelUsage)
              : {}
          Object.assign(error, {
            usage: {
              inputTokens: reported.inputTokens ?? providerUsage.inputTokens,
              outputTokens: reported.outputTokens ?? providerUsage.outputTokens,
              cachedInputTokens:
                reported.cachedInputTokens ?? providerUsage.cachedInputTokens,
              costUsd: providerUsage.costUsd,
            },
          })
        }
        throw error
      }
    },
  }
}
