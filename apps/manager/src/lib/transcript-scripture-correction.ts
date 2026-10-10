import { z } from "zod"

export const TRANSCRIPT_SCRIPTURE_CORRECTION_STATUSES = [
  "applied",
  "flagged",
  "skipped",
  "unavailable",
] as const

export const TRANSCRIPT_SCRIPTURE_CORRECTION_BASES = [
  "model_knowledge",
  "source_bible_text",
  "unavailable",
] as const

export const TRANSCRIPT_SCRIPTURE_CORRECTION_FINDING_ACTIONS = [
  "applied",
  "flagged",
] as const

export const TRANSCRIPT_SCRIPTURE_CORRECTION_CATEGORIES = [
  "scripture_phrase",
  "proper_name",
  "meaning_drift",
  "negation_drift",
  "unsupported_detail",
  "uncertain_reference",
] as const

const CorrectionTextSchema = z.string().min(1).max(240)
const CorrectionReferenceSchema = z.string().min(1).max(80)
const CorrectionRationaleSchema = z.string().min(1).max(240)

export const TranscriptScriptureCorrectionStatusSchema = z.enum(
  TRANSCRIPT_SCRIPTURE_CORRECTION_STATUSES,
)
export const TranscriptScriptureCorrectionBasisSchema = z.enum(
  TRANSCRIPT_SCRIPTURE_CORRECTION_BASES,
)
export const TranscriptScriptureCorrectionFindingActionSchema = z.enum(
  TRANSCRIPT_SCRIPTURE_CORRECTION_FINDING_ACTIONS,
)
export const TranscriptScriptureCorrectionCategorySchema = z.enum(
  TRANSCRIPT_SCRIPTURE_CORRECTION_CATEGORIES,
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
    if (finding.action === "applied" && !finding.correctedText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "applied findings require correctedText",
        path: ["correctedText"],
      })
    }
  })

export type TranscriptScriptureCorrectionFinding = z.infer<
  typeof TranscriptScriptureCorrectionFindingSchema
>

export const TranscriptScriptureCorrectionStepSummarySchema = z
  .object({
    status: TranscriptScriptureCorrectionStatusSchema,
    basis: TranscriptScriptureCorrectionBasisSchema,
    contentDomain: z.enum([
      "bible_story",
      "gospel_teaching",
      "christian_general",
      "other",
    ]),
    confidence: z.number().min(0).max(1),
    checkedReferenceCount: z.number().int().nonnegative(),
    appliedCount: z.number().int().nonnegative(),
    flaggedCount: z.number().int().nonnegative(),
    skippedReason: z.string().min(1).max(80).optional(),
    unavailableReason: z.string().min(1).max(80).optional(),
    likelyBibleReferences: z.array(CorrectionReferenceSchema).max(10),
    findings: z.array(TranscriptScriptureCorrectionFindingSchema).max(20),
  })
  .strict()
  .superRefine((summary, ctx) => {
    const appliedCount = summary.findings.filter(
      (finding) => finding.action === "applied",
    ).length
    const flaggedCount = summary.findings.filter(
      (finding) => finding.action === "flagged",
    ).length

    if (summary.appliedCount !== appliedCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "appliedCount must match applied findings",
        path: ["appliedCount"],
      })
    }
    if (summary.flaggedCount !== flaggedCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "flaggedCount must match flagged findings",
        path: ["flaggedCount"],
      })
    }
    if (summary.status === "unavailable" && !summary.unavailableReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unavailable summaries require unavailableReason",
        path: ["unavailableReason"],
      })
    }
    if (summary.status === "skipped" && !summary.skippedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "skipped summaries require skippedReason",
        path: ["skippedReason"],
      })
    }
  })

export type TranscriptScriptureCorrectionStepSummary = z.infer<
  typeof TranscriptScriptureCorrectionStepSummarySchema
>

export function normalizeTranscriptScriptureCorrectionStepSummary(
  raw: unknown,
): TranscriptScriptureCorrectionStepSummary | undefined {
  const parsed = TranscriptScriptureCorrectionStepSummarySchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}
