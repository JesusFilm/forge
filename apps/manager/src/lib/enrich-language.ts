import {
  resolveCmsLanguageCode,
  resolveMuxSubtitleLanguageCode,
  type CmsLanguageMetadata,
} from "@/lib/mux-language"

export type EnrichVideoVariantLanguage = {
  aiGenerated?: boolean | null
  language?: CmsLanguageMetadata | null
}

export type EnrichVideoLanguageContext = {
  primaryLanguage?: CmsLanguageMetadata | null
  variants?: Array<EnrichVideoVariantLanguage | null> | null
}

export function deriveSourceLanguage(
  video: EnrichVideoLanguageContext,
): CmsLanguageMetadata | null {
  if (video.primaryLanguage) {
    return video.primaryLanguage
  }

  const variants = (video.variants ?? []).filter(
    (variant): variant is EnrichVideoVariantLanguage => variant != null,
  )

  const preferredHumanVariant = variants.find(
    (variant) => variant.aiGenerated === false && variant.language,
  )
  if (preferredHumanVariant?.language) {
    return preferredHumanVariant.language
  }

  const firstLanguageVariant = variants.find((variant) => variant.language)
  return firstLanguageVariant?.language ?? null
}

export function resolveTargetLanguageCodes(
  targetLanguageIds: string[],
  languagesById: ReadonlyMap<string, CmsLanguageMetadata>,
): { codes: string[]; unresolvedIds: string[] } {
  const seen = new Set<string>()
  const codes: string[] = []
  const unresolvedIds: string[] = []

  for (const targetLanguageId of targetLanguageIds) {
    const code = resolveCmsLanguageCode(
      languagesById.get(targetLanguageId) ??
        (isRawLanguageTag(targetLanguageId) ? targetLanguageId : null),
    )

    if (!code) {
      unresolvedIds.push(targetLanguageId)
      continue
    }

    if (seen.has(code)) {
      continue
    }

    seen.add(code)
    codes.push(code)
  }

  return { codes, unresolvedIds }
}

function isRawLanguageTag(value: string): boolean {
  return /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/i.test(value.trim())
}

export function deriveEnrichLanguagePlan(
  video: EnrichVideoLanguageContext,
  targetLanguageIds: string[],
  languagesById: ReadonlyMap<string, CmsLanguageMetadata>,
): {
  sourceLanguage: CmsLanguageMetadata | null
  sourceLanguageCode: string
  muxSubtitleLanguageCode: ReturnType<typeof resolveMuxSubtitleLanguageCode>
  targetLanguageCodes: string[]
  unresolvedTargetLanguageIds: string[]
} {
  const sourceLanguage = deriveSourceLanguage(video)
  const sourceLanguageCode = resolveCmsLanguageCode(sourceLanguage) ?? "auto"
  const { codes, unresolvedIds } = resolveTargetLanguageCodes(
    targetLanguageIds,
    languagesById,
  )

  return {
    sourceLanguage,
    sourceLanguageCode,
    muxSubtitleLanguageCode: resolveMuxSubtitleLanguageCode(sourceLanguage),
    targetLanguageCodes: codes,
    unresolvedTargetLanguageIds: unresolvedIds,
  }
}
