export type LanguageOption = {
  id: string
  englishLabel: string
  nativeLabel: string
}

export type LanguagePreset = {
  id: string
  label: string
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
