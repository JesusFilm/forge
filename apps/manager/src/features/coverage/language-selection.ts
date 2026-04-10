export type LanguageOption = {
  id: string
  englishLabel: string
  nativeLabel: string
}

export type LanguagePreset = {
  id: string
  label: string
}

export type CoverageLanguageSearchParams = {
  languageId?: string
  languageIds?: string
}

const LANGUAGE_PRESET_DEFINITIONS: Array<{
  label: string
  aliases: string[]
}> = [
  {
    label: "English",
    aliases: ["english"],
  },
  {
    label: "French",
    aliases: ["french"],
  },
  {
    label: "Spanish",
    aliases: ["spanish", "castilian"],
  },
  {
    label: "Modern Standard Arabic",
    aliases: [
      "modern standard arabic",
      "arabic standard",
      "standard arabic",
      "arabic",
    ],
  },
] as const

export function hasSelectedLanguages(languageIds: string[]): boolean {
  return languageIds.length > 0
}

export function parseRequestedLanguageIds(raw: string | undefined): string[] {
  if (!raw) return []

  return [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
}

export function resolveRequestedLanguageIds(
  searchParams: CoverageLanguageSearchParams | undefined,
): string[] {
  return parseRequestedLanguageIds(
    searchParams?.languageId ?? searchParams?.languageIds,
  )
}

export function normalizeCoverageLanguageSearchParams(
  currentQuery: string,
  languageIds: string[],
): URLSearchParams {
  const nextParams = new URLSearchParams(currentQuery)

  nextParams.delete("refresh")
  nextParams.delete("languageId")
  nextParams.delete("languageIds")

  if (languageIds.length > 0) {
    nextParams.set("languageId", languageIds.join(","))
  }

  return nextParams
}

export function resolveLanguagePresets(
  languages: LanguageOption[],
): LanguagePreset[] {
  const normalizedOptions = languages.map((language) => ({
    ...language,
    normalizedLabel: language.englishLabel.trim().toLowerCase(),
  }))

  const presets = LANGUAGE_PRESET_DEFINITIONS.map((preset) => {
    const match = normalizedOptions.find((language) =>
      preset.aliases.includes(language.normalizedLabel),
    )

    return match ? { id: match.id, label: preset.label } : null
  })

  return presets.filter((preset): preset is LanguagePreset => preset != null)
}
