type SearchResultLanguageInput = {
  availabilityKind: string | null | undefined
  resultLanguageSlug: string | null | undefined
  resultLanguageEnglishName: string | null | undefined
  actionLanguageSlug: string | null | undefined
  availabilityLanguageSlug: string | null | undefined
  availabilityLanguageEnglishName: string | null | undefined
}

export function resolveSearchResultLanguages({
  availabilityKind,
  resultLanguageSlug,
  resultLanguageEnglishName,
  actionLanguageSlug,
  availabilityLanguageSlug,
  availabilityLanguageEnglishName,
}: SearchResultLanguageInput): {
  languageSlug: string | null
  languageEnglishName: string | null
  subtitleLanguageSlug: string | null
  availabilityLanguageEnglishName: string | null
} {
  if (availabilityKind === "target_subtitle") {
    return {
      languageSlug: actionLanguageSlug ?? null,
      languageEnglishName: null,
      subtitleLanguageSlug: availabilityLanguageSlug ?? null,
      availabilityLanguageEnglishName:
        availabilityLanguageEnglishName ?? resultLanguageEnglishName ?? null,
    }
  }
  return {
    languageSlug: actionLanguageSlug ?? resultLanguageSlug ?? null,
    languageEnglishName: resultLanguageEnglishName ?? null,
    subtitleLanguageSlug: null,
    availabilityLanguageEnglishName:
      availabilityLanguageEnglishName ?? resultLanguageEnglishName ?? null,
  }
}
