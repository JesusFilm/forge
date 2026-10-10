import { z } from "zod"

import { env } from "@/config/env"
import type { TranscriptSegment } from "@/services/transcription"

export type MastraTranscriptScriptureCorrectionContext = {
  videoTitle?: string
  videoLabel?: string
  bibleReferences?: string[]
}

export type MastraTranscriptScriptureCorrectionInput = {
  assetId: string
  sourceLanguage: string
  segments: TranscriptSegment[]
  model?: string
  translationContext?: MastraTranscriptScriptureCorrectionContext
  provider?: {
    name?: string
    source?: string
  }
}

export type MastraTranscriptScriptureCorrectionFinding = {
  action: "apply_candidate" | "flag_only"
  category:
    | "scripture_phrase"
    | "proper_name"
    | "meaning_drift"
    | "negation_drift"
    | "unsupported_detail"
    | "uncertain_reference"
  segmentIndex: number
  start: number
  end: number
  originalText: string
  correctedText?: string
  reference?: string
  confidence: number
  basis: "model_knowledge" | "source_bible_text"
  rationale: string
}

export type MastraTranscriptScriptureCorrection = {
  status: "reviewed" | "skipped" | "unavailable"
  basis: "model_knowledge" | "source_bible_text" | "unavailable"
  contentDomain:
    | "bible_story"
    | "gospel_teaching"
    | "christian_general"
    | "other"
  confidence: number
  checkedReferenceCount: number
  candidateCount: number
  flaggedCount: number
  skippedReason?: string
  unavailableReason?: string
  likelyBibleReferences: string[]
  findings: MastraTranscriptScriptureCorrectionFinding[]
}

export type MastraTranscriptScriptureCorrectionResult =
  | {
      ok: true
      mastraRunId: string
      correction: MastraTranscriptScriptureCorrection
    }
  | {
      ok: false
      reason:
        | "config_missing"
        | "auth_failed"
        | "network_error"
        | "parse_error"
        | "invalid_input"
        | "workflow_failed"
      retryable: boolean
      mastraRunId?: string
      message?: string
    }

export type LaunchMastraTranscriptScriptureCorrectionOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const FindingSchema = z
  .object({
    action: z.enum(["apply_candidate", "flag_only"]),
    category: z.enum([
      "scripture_phrase",
      "proper_name",
      "meaning_drift",
      "negation_drift",
      "unsupported_detail",
      "uncertain_reference",
    ]),
    segmentIndex: z.number().int().nonnegative(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    originalText: z.string().min(1).max(240),
    correctedText: z.string().min(1).max(240).optional(),
    reference: z.string().min(1).max(80).optional(),
    confidence: z.number().min(0).max(1),
    basis: z.enum(["model_knowledge", "source_bible_text"]),
    rationale: z.string().min(1).max(240),
  })
  .strict()

const CorrectionSchema = z
  .object({
    status: z.enum(["reviewed", "skipped", "unavailable"]),
    basis: z.enum(["model_knowledge", "source_bible_text", "unavailable"]),
    contentDomain: z.enum([
      "bible_story",
      "gospel_teaching",
      "christian_general",
      "other",
    ]),
    confidence: z.number().min(0).max(1),
    checkedReferenceCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    flaggedCount: z.number().int().nonnegative(),
    skippedReason: z.string().min(1).max(80).optional(),
    unavailableReason: z.string().min(1).max(80).optional(),
    likelyBibleReferences: z.array(z.string().min(1).max(80)).max(10),
    findings: z.array(FindingSchema).max(20),
  })
  .strict()

const SuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string().min(1),
    correction: CorrectionSchema,
  })
  .strict()

const FailureSchema = z
  .object({
    ok: z.literal(false),
    mastraRunId: z.string().min(1).optional(),
    reason: z.enum(["invalid_input", "workflow_failed"]),
    retryable: z.boolean(),
    message: z.string().optional(),
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
  | Extract<MastraTranscriptScriptureCorrectionResult, { ok: true }>
  | Extract<MastraTranscriptScriptureCorrectionResult, { ok: false }>
  | null {
  const parsed = EnvelopeSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data.result
}

export async function launchMastraTranscriptScriptureCorrection(
  input: MastraTranscriptScriptureCorrectionInput,
  options: LaunchMastraTranscriptScriptureCorrectionOptions = {},
): Promise<MastraTranscriptScriptureCorrectionResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/forge-transcript-scripture-correction", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          assetId: input.assetId,
          sourceLanguage: input.sourceLanguage,
          segments: input.segments,
          ...(input.model ? { model: input.model } : {}),
          ...(input.translationContext
            ? { translationContext: input.translationContext }
            : {}),
          ...(input.provider ? { provider: input.provider } : {}),
        }),
        signal: AbortSignal.timeout(
          options.timeoutMs ??
            env.MASTRA_TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS ??
            120_000,
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
