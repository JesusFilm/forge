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

export type CoverageLanguageSelectionResolution = {
  languageIds: string[]
  shouldReplaceUrl: boolean
  shouldRememberSelection: boolean
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

export const COVERAGE_LANGUAGE_SELECTION_STORAGE_KEY =
  "forge-coverage-language-ids"

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

function toSearchParams(
  currentQuery: string | URLSearchParams,
): URLSearchParams {
  if (currentQuery instanceof URLSearchParams) {
    return new URLSearchParams(currentQuery)
  }

  return new URLSearchParams(currentQuery.replace(/^\?/, ""))
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

export function resolveEnglishLanguageId(
  languages: LanguageOption[],
): string | null {
  return (
    resolveLanguagePresets(languages).find(
      (preset) => preset.label === "English",
    )?.id ?? null
  )
}

export function readRememberedCoverageLanguageIds(
  storage: StorageLike | undefined,
): string[] {
  if (!storage) return []

  try {
    return parseRequestedLanguageIds(
      storage.getItem(COVERAGE_LANGUAGE_SELECTION_STORAGE_KEY) ?? undefined,
    )
  } catch {
    return []
  }
}

export function writeRememberedCoverageLanguageIds(
  storage: StorageLike | undefined,
  languageIds: string[],
) {
  if (!storage) return

  const normalized = parseRequestedLanguageIds(languageIds.join(","))

  try {
    if (normalized.length === 0) {
      storage.removeItem(COVERAGE_LANGUAGE_SELECTION_STORAGE_KEY)
      return
    }

    storage.setItem(
      COVERAGE_LANGUAGE_SELECTION_STORAGE_KEY,
      normalized.join(","),
    )
  } catch {
    // Ignore storage errors so private browsing or quota issues do not break navigation.
  }
}

export function clearRememberedCoverageLanguageIds(
  storage: StorageLike | undefined,
) {
  if (!storage) return

  try {
    storage.removeItem(COVERAGE_LANGUAGE_SELECTION_STORAGE_KEY)
  } catch {
    // Ignore storage errors.
  }
}

export function resolveCoverageLanguageSelection({
  currentQuery,
  rememberedLanguageIds,
  languages,
}: {
  currentQuery: string | URLSearchParams
  rememberedLanguageIds: string[]
  languages: LanguageOption[]
}): CoverageLanguageSelectionResolution {
  const params = toSearchParams(currentQuery)
  const requestedLanguageIds = resolveRequestedLanguageIds({
    languageId: params.get("languageId") ?? undefined,
    languageIds: params.get("languageIds") ?? undefined,
  })

  if (params.has("languageId")) {
    return {
      languageIds: requestedLanguageIds,
      shouldReplaceUrl: false,
      shouldRememberSelection: requestedLanguageIds.length > 0,
    }
  }

  if (params.has("languageIds")) {
    return {
      languageIds: requestedLanguageIds,
      shouldReplaceUrl: true,
      shouldRememberSelection: requestedLanguageIds.length > 0,
    }
  }

  const remembered = parseRequestedLanguageIds(rememberedLanguageIds.join(","))
  if (remembered.length > 0) {
    return {
      languageIds: remembered,
      shouldReplaceUrl: true,
      shouldRememberSelection: false,
    }
  }

  const englishLanguageId = resolveEnglishLanguageId(languages)
  if (englishLanguageId) {
    return {
      languageIds: [englishLanguageId],
      shouldReplaceUrl: true,
      shouldRememberSelection: false,
    }
  }

  return {
    languageIds: [],
    shouldReplaceUrl: false,
    shouldRememberSelection: false,
  }
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
