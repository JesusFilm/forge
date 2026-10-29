import { z } from "zod"

export const CALLBACK_MAX_LANGUAGES = 50
export const CALLBACK_MAX_ARTIFACTS = 1 + 3 * CALLBACK_MAX_LANGUAGES
export const CALLBACK_BODY_MAX_BYTES = 64 * 1024
const language = z.string().min(1).max(32)
const count = z.number().int().nonnegative().max(1_000_000)
const short = z.string().min(1).max(128)
const uniqueLanguages = z
  .array(language)
  .max(CALLBACK_MAX_LANGUAGES)
  .refine(
    (values) =>
      new Set(values.map((value) => value.toLowerCase())).size ===
      values.length,
    "Duplicate languages",
  )
const verdict = z.enum(["pass", "warning", "needs_review", "unavailable"])
const validationResult = z
  .object({
    lang: language,
    verdict,
    basis: z.enum(["model_knowledge", "target_bible_text", "unavailable"]),
    confidence: z.number().min(0).max(1),
    checkedReferenceCount: count,
    warningCount: count,
    needsReviewCount: count,
    fallbackReason: z
      .enum([
        "provider_config_missing",
        "provider_auth_failed",
        "provider_failed",
        "provider_invalid_output",
        "bible_mapping_missing",
        "reference_unsupported",
        "provider_rate_limited",
      ])
      .optional(),
    unavailableReason: z.string().min(1).max(80).optional(),
  })
  .strict()
const subtitleValidation = z
  .object({
    highestVerdict: verdict,
    languagesChecked: count.max(CALLBACK_MAX_LANGUAGES),
    modelOnlyLanguages: uniqueLanguages,
    unavailableLanguages: uniqueLanguages,
    warningCount: count,
    needsReviewCount: count,
    results: z.array(validationResult).max(CALLBACK_MAX_LANGUAGES),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.results.map((result) => result.lang.toLowerCase())).size ===
        value.results.length && value.languagesChecked === value.results.length,
    "Invalid language summary",
  )
const correctionFinding = z
  .object({
    action: z.enum(["applied", "flagged"]),
    category: z.enum([
      "scripture_phrase",
      "proper_name",
      "meaning_drift",
      "negation_drift",
      "unsupported_detail",
      "uncertain_reference",
    ]),
    segmentIndex: count,
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
  .refine(
    (value) =>
      value.end >= value.start &&
      (value.action !== "applied" || Boolean(value.correctedText)),
    "Invalid correction finding",
  )
const transcriptCorrection = z
  .object({
    status: z.enum(["applied", "flagged", "skipped", "unavailable"]),
    basis: z.enum(["model_knowledge", "source_bible_text", "unavailable"]),
    contentDomain: z.enum([
      "bible_story",
      "gospel_teaching",
      "christian_general",
      "other",
    ]),
    confidence: z.number().min(0).max(1),
    checkedReferenceCount: count,
    appliedCount: count.max(20),
    flaggedCount: count.max(20),
    skippedReason: z.string().min(1).max(80).optional(),
    unavailableReason: z.string().min(1).max(80).optional(),
    likelyBibleReferences: z.array(z.string().min(1).max(80)).max(10),
    findings: z.array(correctionFinding).max(20),
  })
  .strict()
  .refine(
    (value) =>
      value.appliedCount ===
        value.findings.filter((finding) => finding.action === "applied")
          .length &&
      value.flaggedCount ===
        value.findings.filter((finding) => finding.action === "flagged").length,
    "Invalid correction counts",
  )
export const CallbackStepDetailsSchema = z
  .object({
    mastra: z
      .object({
        runId: short,
        status: short.optional(),
        reason: short.optional(),
        retryable: z.boolean().optional(),
        provider: short.optional(),
        model: short.optional(),
        chunks: count.optional(),
        totalTokens: count.optional(),
        sourceContentHash: z
          .string()
          .regex(/^(?:sha256:)?[a-f0-9]{64}$/)
          .optional(),
        languages: uniqueLanguages.optional(),
      })
      .strict()
      .optional(),
    subtitleValidation: subtitleValidation.optional(),
    transcriptCorrection: transcriptCorrection.optional(),
  })
  .strict()
const attempt = z
  .object({
    attemptId: short,
    requestedProvider: z.enum(["automatic", "elevenlabs", "mux"]),
    resolvedProvider: z.enum(["elevenlabs", "mux"]),
    status: z.enum(["running", "completed", "failed", "fallback_completed"]),
    sourceLanguageCode: language.optional(),
    decisionReason: z.string().max(500).optional(),
    fallbackFromProvider: z.literal("elevenlabs").optional(),
    fallbackReason: z.string().max(500).optional(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().optional(),
  })
  .strict()
const comparison = z
  .object({
    artifactKey: short,
    targetLanguage: language,
    muxTargetType: z.literal("text_track"),
    muxTargetKey: short,
    status: z.enum([
      "synced",
      "skipped_existing_mux_data",
      "skipped_missing_generated_data",
      "override_pending",
      "override_applied",
      "reconciliation_required",
      "failed",
    ]),
    explanation: z.string().max(500),
    generatedPreview: z.string().max(500).optional(),
    muxPreview: z.string().max(500).optional(),
    muxTrackId: short.optional(),
    canOverride: z.boolean().optional(),
    updatedAt: z.iso.datetime().optional(),
  })
  .strict()
export const CallbackReportsSchema = z
  .object({
    transcriptionRouting: z
      .object({
        sourceInputHost: z.string().max(253).optional(),
        diarization: z
          .object({
            speakerCount: count.max(100).optional(),
            segments: z
              .array(
                z
                  .object({
                    speakerId: short,
                    start: z.number().nonnegative(),
                    end: z.number().nonnegative(),
                    text: z.string().max(240).optional(),
                  })
                  .strict(),
              )
              .max(100)
              .optional(),
          })
          .strict()
          .optional(),
        currentAttemptId: short.optional(),
        attempts: z.array(attempt).max(10),
        finalProvider: z.enum(["elevenlabs", "mux"]).optional(),
        finalSourceLanguageCode: language.optional(),
        fallbackReason: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    muxSync: z
      .object({
        comparisons: z.array(comparison).max(CALLBACK_MAX_LANGUAGES),
        updatedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type CallbackReports = z.infer<typeof CallbackReportsSchema>
