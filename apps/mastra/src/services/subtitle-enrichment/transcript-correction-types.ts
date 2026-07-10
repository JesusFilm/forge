import { z } from "zod"

import { SubtitleContentDomainSchema } from "./types"

export const TranscriptScriptureCorrectionBases = [
  "model_knowledge",
  "source_bible_text",
  "unavailable",
] as const

export const TranscriptScriptureCorrectionStatuses = [
  "reviewed",
  "skipped",
  "unavailable",
] as const

export const TranscriptScriptureCorrectionFindingActions = [
  "apply_candidate",
  "flag_only",
] as const

export const TranscriptScriptureCorrectionCategories = [
  "scripture_phrase",
  "proper_name",
  "meaning_drift",
  "negation_drift",
  "unsupported_detail",
  "uncertain_reference",
] as const

const CorrectionTextSchema = z.string().min(1).max(240)
const CorrectionRationaleSchema = z.string().min(1).max(240)
const CorrectionReferenceSchema = z.string().min(1).max(80)

export const TranscriptScriptureCorrectionBasisSchema = z.enum(
  TranscriptScriptureCorrectionBases,
)
export const TranscriptScriptureCorrectionStatusSchema = z.enum(
  TranscriptScriptureCorrectionStatuses,
)
export const TranscriptScriptureCorrectionFindingActionSchema = z.enum(
  TranscriptScriptureCorrectionFindingActions,
)
export const TranscriptScriptureCorrectionCategorySchema = z.enum(
  TranscriptScriptureCorrectionCategories,
)

export const TranscriptScriptureCorrectionFindingSchema = z
  .object({
    action: TranscriptScriptureCorrectionFindingActionSchema,
    category: TranscriptScriptureCorrectionCategorySchema,
    segmentIndex: z.number().int().nonnegative(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    originalText: CorrectionTextSchema,
    correctedText: CorrectionTextSchema.optional(),
    reference: CorrectionReferenceSchema.optional(),
    confidence: z.number().min(0).max(1),
    basis: TranscriptScriptureCorrectionBasisSchema.exclude(["unavailable"]),
    rationale: CorrectionRationaleSchema,
  })
  .strict()
  .superRefine((finding, ctx) => {
    if (finding.end < finding.start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "end must be greater than or equal to start",
        path: ["end"],
      })
    }
    if (finding.action === "apply_candidate" && !finding.correctedText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "apply_candidate findings require correctedText",
        path: ["correctedText"],
      })
    }
  })

export type TranscriptScriptureCorrectionFinding = z.infer<
  typeof TranscriptScriptureCorrectionFindingSchema
>

export const TranscriptScriptureCorrectionResultSchema = z
  .object({
    status: TranscriptScriptureCorrectionStatusSchema,
    basis: TranscriptScriptureCorrectionBasisSchema,
    contentDomain: SubtitleContentDomainSchema,
    confidence: z.number().min(0).max(1),
    checkedReferenceCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    flaggedCount: z.number().int().nonnegative(),
    skippedReason: z.string().min(1).max(80).optional(),
    unavailableReason: z.string().min(1).max(80).optional(),
    likelyBibleReferences: z.array(CorrectionReferenceSchema).max(10),
    findings: z.array(TranscriptScriptureCorrectionFindingSchema).max(20),
  })
  .strict()
  .superRefine((result, ctx) => {
    const candidateCount = result.findings.filter(
      (finding) => finding.action === "apply_candidate",
    ).length
    const flaggedCount = result.findings.filter(
      (finding) => finding.action === "flag_only",
    ).length

    if (result.candidateCount !== candidateCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "candidateCount must match apply_candidate findings",
        path: ["candidateCount"],
      })
    }
    if (result.flaggedCount !== flaggedCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "flaggedCount must match flag_only findings",
        path: ["flaggedCount"],
      })
    }
    if (result.status === "unavailable" && !result.unavailableReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unavailable results require unavailableReason",
        path: ["unavailableReason"],
      })
    }
    if (result.status === "skipped" && !result.skippedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "skipped results require skippedReason",
        path: ["skippedReason"],
      })
    }
  })

export type TranscriptScriptureCorrectionResult = z.infer<
  typeof TranscriptScriptureCorrectionResultSchema
>

export const TranscriptScriptureCorrectionModelOutputSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    likelyBibleReferences: z.array(CorrectionReferenceSchema).max(10),
    findings: z.array(TranscriptScriptureCorrectionFindingSchema).max(20),
  })
  .strict()

export type TranscriptScriptureCorrectionModelOutput = z.infer<
  typeof TranscriptScriptureCorrectionModelOutputSchema
>

export const TranscriptScriptureCorrectionModelOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
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
          action: {
            type: "string",
            enum: TranscriptScriptureCorrectionFindingActions,
          },
          category: {
            type: "string",
            enum: TranscriptScriptureCorrectionCategories,
          },
          segmentIndex: { type: "integer", minimum: 0 },
          start: { type: "number", minimum: 0 },
          end: { type: "number", minimum: 0 },
          originalText: { type: "string", minLength: 1, maxLength: 240 },
          correctedText: { type: "string", minLength: 1, maxLength: 240 },
          reference: { type: "string", minLength: 1, maxLength: 80 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          basis: {
            type: "string",
            enum: ["model_knowledge", "source_bible_text"],
          },
          rationale: { type: "string", minLength: 1, maxLength: 240 },
        },
        required: [
          "action",
          "category",
          "segmentIndex",
          "start",
          "end",
          "originalText",
          "confidence",
          "basis",
          "rationale",
        ],
      },
    },
  },
  required: ["confidence", "likelyBibleReferences", "findings"],
} as const
