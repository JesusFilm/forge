import { z } from "zod"

import { env } from "@/config/env"
import {
  SubtitleValidationSummarySchema,
  type SubtitleValidationSummary,
} from "@/lib/subtitle-validation"

export type LanguageResult = {
  lang: string
  status: "completed" | "failed"
  error?: string
  artifactKeys?: { vtt: string; json: string; validation?: string }
  validationSummary?: SubtitleValidationSummary
}

export type MastraSubtitleTranslationContext = {
  videoTitle?: string
  videoLabel?: string
  bibleReferences?: string[]
}

export type MastraSubtitleEnrichmentInput = {
  assetId: string
  sourceLanguage: string
  targetLanguages: string[]
  model?: string
  translationContext?: MastraSubtitleTranslationContext
}

export type MastraSubtitleEnrichmentResult =
  | {
      ok: true
      mastraRunId: string
      languages: LanguageResult[]
      succeeded: number
      failed: number
    }
  | {
      ok: false
      reason:
        | "config_missing"
        | "auth_failed"
        | "network_error"
        | "parse_error"
        | "invalid_input"
        | "provider_config_missing"
        | "storage_failed"
        | "all_languages_failed"
      retryable: boolean
      mastraRunId?: string
      message?: string
      languages?: LanguageResult[]
    }

export type LaunchMastraSubtitleEnrichmentOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const LanguageResultSchema = z
  .object({
    lang: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    error: z.string().optional(),
    artifactKeys: z
      .object({
        vtt: z.string().min(1),
        json: z.string().min(1),
        validation: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    validationSummary: SubtitleValidationSummarySchema.optional(),
  })
  .strict()

const SuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string().min(1),
    languages: z.array(LanguageResultSchema),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .strict()

const FailureSchema = z
  .object({
    ok: z.literal(false),
    mastraRunId: z.string().min(1).optional(),
    reason: z.enum([
      "invalid_input",
      "config_missing",
      "provider_config_missing",
      "storage_failed",
      "all_languages_failed",
    ]),
    retryable: z.boolean(),
    message: z.string().optional(),
    languages: z.array(LanguageResultSchema).optional(),
  })
  .strict()

const EnvelopeSchema = z
  .object({
    result: z.discriminatedUnion("ok", [SuccessSchema, FailureSchema]),
  })
  .strict()

function parseWorkflowResult(
  value: unknown,
):
  | Extract<MastraSubtitleEnrichmentResult, { ok: true }>
  | Extract<MastraSubtitleEnrichmentResult, { ok: false }>
  | null {
  const parsed = EnvelopeSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data.result
}

export async function launchMastraSubtitleEnrichment(
  input: MastraSubtitleEnrichmentInput,
  options: LaunchMastraSubtitleEnrichmentOptions = {},
): Promise<MastraSubtitleEnrichmentResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/forge-subtitle-enrichment", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          assetId: input.assetId,
          sourceLanguage: input.sourceLanguage,
          targetLanguages: input.targetLanguages,
          ...(input.model ? { model: input.model } : {}),
          ...(input.translationContext
            ? { translationContext: input.translationContext }
            : {}),
        }),
        signal: AbortSignal.timeout(
          options.timeoutMs ??
            env.MASTRA_SUBTITLE_ENRICHMENT_TIMEOUT_MS ??
            300_000,
        ),
      },
    )
  } catch {
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (response.status === 401) {
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  const result = parseWorkflowResult(
    await response.json().catch(() => undefined),
  )
  if (result) {
    return result
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "network_error",
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseWorkflowResult,
}
