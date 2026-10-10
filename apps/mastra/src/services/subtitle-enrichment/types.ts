import { z } from "zod"

export type TranscriptSegment = {
  start: number
  end: number
  text: string
}

export type Chunk = {
  index: number
  segments: TranscriptSegment[]
  startTime: number
  endTime: number
  sourceText: string
}

export type LanguageConfig = {
  customPrompt?: string
  glossary?: Record<string, string>
}

export const SubtitleTranslationContextSchema = z
  .object({
    videoTitle: z.string().min(1).optional(),
    videoLabel: z.string().min(1).optional(),
    bibleReferences: z.array(z.string().min(1).max(80)).max(20).optional(),
  })
  .strict()

export type SubtitleTranslationContext = z.infer<
  typeof SubtitleTranslationContextSchema
>

export const SubtitleContentDomainSchema = z.enum([
  "bible_story",
  "gospel_teaching",
  "christian_general",
  "other",
])

export type SubtitleContentDomain = z.infer<typeof SubtitleContentDomainSchema>

export const SubtitleScriptureContextSchema = z
  .object({
    contentDomain: SubtitleContentDomainSchema,
    likelyBibleReferences: z.array(z.string().min(1).max(80)).max(10),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(240).optional(),
  })
  .strict()

export type SubtitleScriptureContext = z.infer<
  typeof SubtitleScriptureContextSchema
>

export const SubtitleScriptureValidationBasisSchema = z.enum([
  "model_knowledge",
  "target_bible_text",
  "unavailable",
])

export type SubtitleScriptureValidationBasis = z.infer<
  typeof SubtitleScriptureValidationBasisSchema
>

export const SubtitleScriptureValidationVerdictSchema = z.enum([
  "pass",
  "warning",
  "needs_review",
  "unavailable",
])

export type SubtitleScriptureValidationVerdict = z.infer<
  typeof SubtitleScriptureValidationVerdictSchema
>

export const SubtitleScriptureValidationFallbackReasonSchema = z.enum([
  "provider_config_missing",
  "provider_auth_failed",
  "provider_failed",
  "provider_invalid_output",
  "bible_mapping_missing",
  "reference_unsupported",
  "provider_rate_limited",
])

export type SubtitleScriptureValidationFallbackReason = z.infer<
  typeof SubtitleScriptureValidationFallbackReasonSchema
>

export const SubtitleScriptureValidationFindingSchema = z
  .object({
    severity: z.enum(["warning", "needs_review"]),
    category: z.enum([
      "meaning_drift",
      "omission",
      "addition",
      "proper_name",
      "theological_term",
      "unsupported_detail",
      "uncertain_reference",
    ]),
    message: z.string().min(1).max(240),
    reference: z.string().min(1).max(80).optional(),
    segmentIndexes: z.array(z.number().int().nonnegative()).max(20).optional(),
    evidence: z.string().min(1).max(240).optional(),
  })
  .strict()

export type SubtitleScriptureValidationFinding = z.infer<
  typeof SubtitleScriptureValidationFindingSchema
>

export const SubtitleScriptureValidationSummarySchema = z
  .object({
    verdict: SubtitleScriptureValidationVerdictSchema,
    basis: SubtitleScriptureValidationBasisSchema,
    confidence: z.number().min(0).max(1),
    checkedReferenceCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    needsReviewCount: z.number().int().nonnegative(),
    fallbackReason: SubtitleScriptureValidationFallbackReasonSchema.optional(),
    unavailableReason: z.string().min(1).max(80).optional(),
  })
  .strict()

export type SubtitleScriptureValidationSummary = z.infer<
  typeof SubtitleScriptureValidationSummarySchema
>

export const SubtitleScriptureValidationResultSchema =
  SubtitleScriptureValidationSummarySchema.extend({
    targetLanguage: z.string().min(1),
    contentDomain: SubtitleContentDomainSchema,
    likelyBibleReferences: z.array(z.string().min(1).max(80)).max(10),
    provider: z
      .object({
        name: z.string().min(1).max(80),
        bibleId: z.string().min(1).max(120),
        language: z.string().min(1).max(40),
        reference: z.string().min(1).max(120),
        versionLabel: z.string().min(1).max(120).optional(),
        copyright: z.string().min(1).max(240).optional(),
      })
      .strict()
      .optional(),
    findings: z.array(SubtitleScriptureValidationFindingSchema).max(20),
  }).strict()

export type SubtitleScriptureValidationResult = z.infer<
  typeof SubtitleScriptureValidationResultSchema
>

export const SubtitleScriptureValidationModelOutputSchema = z
  .object({
    verdict: z.enum(["pass", "warning", "needs_review"]),
    confidence: z.number().min(0).max(1),
    likelyBibleReferences: z.array(z.string().min(1).max(80)).max(10),
    findings: z.array(SubtitleScriptureValidationFindingSchema).max(20),
  })
  .strict()

export type SubtitleScriptureValidationModelOutput = z.infer<
  typeof SubtitleScriptureValidationModelOutputSchema
>

export const SubtitleScriptureValidationModelOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["pass", "warning", "needs_review"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    likelyBibleReferences: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 80 },
      maxItems: 10,
    },
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: {
            type: "string",
            enum: ["warning", "needs_review"],
          },
          category: {
            type: "string",
            enum: [
              "meaning_drift",
              "omission",
              "addition",
              "proper_name",
              "theological_term",
              "unsupported_detail",
              "uncertain_reference",
            ],
          },
          message: { type: "string", minLength: 1, maxLength: 240 },
          reference: { type: "string", minLength: 1, maxLength: 80 },
          segmentIndexes: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            maxItems: 20,
          },
          evidence: { type: "string", minLength: 1, maxLength: 240 },
        },
        required: ["severity", "category", "message"],
      },
    },
  },
  required: ["verdict", "confidence", "likelyBibleReferences", "findings"],
} as const

export const SubtitleScriptureContextJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    contentDomain: {
      type: "string",
      enum: ["bible_story", "gospel_teaching", "christian_general", "other"],
    },
    likelyBibleReferences: {
      type: "array",
      items: { type: "string", maxLength: 80 },
      maxItems: 10,
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string", maxLength: 240 },
  },
  required: ["contentDomain", "likelyBibleReferences", "confidence"],
} as const

export const RetimingOutputSchema = z
  .object({
    segments: z.array(
      z
        .object({
          start: z.number(),
          end: z.number(),
          text: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()

export type RetimingOutput = z.infer<typeof RetimingOutputSchema>

export const RetimingOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          text: { type: "string" },
        },
        required: ["start", "end", "text"],
      },
    },
  },
  required: ["segments"],
} as const

export const SubtitleLanguageResultSchema = z
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
    validationSummary: SubtitleScriptureValidationSummarySchema.optional(),
  })
  .strict()

export type SubtitleLanguageResult = z.infer<
  typeof SubtitleLanguageResultSchema
>

export class SubtitleProviderError extends Error {
  constructor(
    readonly reason:
      | "provider_config_missing"
      | "provider_auth_failed"
      | "provider_failed"
      | "provider_invalid_output",
    readonly retryable: boolean,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SubtitleProviderError"
  }
}
