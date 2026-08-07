import type { Route } from "next"

import {
  isConsolidatedEnglishHomeLanguageSlug,
  isPublicWatchLanguageSlug,
} from "./locale"
import {
  languageVideosIndexPath,
  localizedHistoryPath,
  localizedHomePath,
  localizedLanguagesPath,
  parseWatchPath,
  tryAsLocaleSlug,
} from "./routes"
import type { SearchLanguageOption } from "./search-language"

export type GlobalLanguageOption = {
  slug: string
  englishName: string
  nativeName: string | null
}

/** Project cached search metadata into the compact, routable picker shape. */
export function projectGlobalLanguageOptions(
  options: readonly SearchLanguageOption[],
): GlobalLanguageOption[] {
  const bySlug = new Map<string, GlobalLanguageOption>()

  for (const option of options) {
    const slug = option.publicSlug
    if (!slug || !isPublicWatchLanguageSlug(slug)) continue

    const projected = {
      slug,
      englishName: option.englishName,
      nativeName: option.nativeName,
    }
    const existing = bySlug.get(slug)
    if (!existing || (!existing.nativeName && projected.nativeName)) {
      bySlug.set(slug, projected)
    }
  }

  return [...bySlug.values()].sort((a, b) =>
    a.englishName.localeCompare(b.englishName),
  )
}

/**
 * Select a destination for the global fallback. Content pages use it only
 * when their playable-language picker is unavailable, so they land on the
 * selected home rather than claiming an unverified content alternative.
 */
export function languageSwitcherTarget(
  pathname: string,
  selectedLanguageSlug: string,
): Route | null {
  if (!isPublicWatchLanguageSlug(selectedLanguageSlug)) return null
  const language = tryAsLocaleSlug(selectedLanguageSlug)
  if (!language) return null

  switch (parseWatchPath(pathname).kind) {
    case "language-videos":
      return languageVideosIndexPath(language)
    case "languages":
    case "localized-languages":
      return localizedLanguagesPath(language)
    case "history":
    case "localized-history":
      return localizedHistoryPath(language)
    default:
      if (isConsolidatedEnglishHomeLanguageSlug(language)) {
        return language === "english"
          ? "/"
          : languageVideosIndexPath(language)
      }
      return localizedHomePath(language)
  }
}
