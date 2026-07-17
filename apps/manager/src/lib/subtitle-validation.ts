import { z } from "zod"

export const SUBTITLE_VALIDATION_VERDICTS = [
  "pass",
  "warning",
  "needs_review",
  "unavailable",
] as const

export const SUBTITLE_VALIDATION_BASES = [
  "model_knowledge",
  "target_bible_text",
  "unavailable",
] as const

export const SUBTITLE_VALIDATION_FALLBACK_REASONS = [
  "provider_config_missing",
  "provider_auth_failed",
  "provider_failed",
  "provider_invalid_output",
  "bible_mapping_missing",
  "reference_unsupported",
  "provider_rate_limited",
] as const

export const SubtitleValidationSummarySchema = z
  .object({
    verdict: z.enum(SUBTITLE_VALIDATION_VERDICTS),
    basis: z.enum(SUBTITLE_VALIDATION_BASES),
    confidence: z.number().min(0).max(1),
    checkedReferenceCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    needsReviewCount: z.number().int().nonnegative(),
    fallbackReason: z.enum(SUBTITLE_VALIDATION_FALLBACK_REASONS).optional(),
    unavailableReason: z.string().min(1).max(80).optional(),
  })
  .strict()

export type SubtitleValidationSummary = z.infer<
  typeof SubtitleValidationSummarySchema
>
export type SubtitleValidationVerdict =
  (typeof SUBTITLE_VALIDATION_VERDICTS)[number]
export type SubtitleValidationBasis = (typeof SUBTITLE_VALIDATION_BASES)[number]

export type SubtitleValidationLanguageSummary = SubtitleValidationSummary & {
  lang: string
}

export type SubtitleValidationStepSummary = {
  highestVerdict: SubtitleValidationVerdict
  languagesChecked: number
  modelOnlyLanguages: string[]
  unavailableLanguages: string[]
  warningCount: number
  needsReviewCount: number
  results: SubtitleValidationLanguageSummary[]
}

function normalizeSubtitleValidationLanguageSummary(
  raw: unknown,
): SubtitleValidationLanguageSummary | null {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return null
  }
  const candidate = raw as { lang?: unknown }
  if (typeof candidate.lang !== "string") {
    return null
  }
  const source = raw as Record<string, unknown>
  const summary = {
    verdict: source.verdict,
    basis: source.basis,
    confidence: source.confidence,
    checkedReferenceCount: source.checkedReferenceCount,
    warningCount: source.warningCount,
    needsReviewCount: source.needsReviewCount,
    fallbackReason: source.fallbackReason,
    unavailableReason: source.unavailableReason,
  }
  const parsed = SubtitleValidationSummarySchema.safeParse(summary)
  if (!parsed.success) {
    return null
  }

  return {
    lang: candidate.lang,
    ...parsed.data,
  }
}

export function normalizeSubtitleValidationStepSummary(
  raw: unknown,
): SubtitleValidationStepSummary | undefined {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return undefined
  }
  const candidate = raw as {
    highestVerdict?: unknown
    languagesChecked?: unknown
    modelOnlyLanguages?: unknown
    unavailableLanguages?: unknown
    warningCount?: unknown
    needsReviewCount?: unknown
    results?: unknown
  }
  const results = Array.isArray(candidate.results)
    ? candidate.results
        .map(normalizeSubtitleValidationLanguageSummary)
        .filter(
          (result): result is SubtitleValidationLanguageSummary =>
            result != null,
        )
    : []
  if (
    !SUBTITLE_VALIDATION_VERDICTS.includes(
      candidate.highestVerdict as SubtitleValidationVerdict,
    ) ||
    typeof candidate.languagesChecked !== "number" ||
    !Array.isArray(candidate.modelOnlyLanguages) ||
    !Array.isArray(candidate.unavailableLanguages) ||
    typeof candidate.warningCount !== "number" ||
    typeof candidate.needsReviewCount !== "number" ||
    results.length === 0
  ) {
    return undefined
  }

  return {
    highestVerdict: candidate.highestVerdict as SubtitleValidationVerdict,
    languagesChecked: candidate.languagesChecked,
    modelOnlyLanguages: candidate.modelOnlyLanguages.filter(
      (language): language is string => typeof language === "string",
    ),
    unavailableLanguages: candidate.unavailableLanguages.filter(
      (language): language is string => typeof language === "string",
    ),
    warningCount: candidate.warningCount,
    needsReviewCount: candidate.needsReviewCount,
    results,
  }
}
