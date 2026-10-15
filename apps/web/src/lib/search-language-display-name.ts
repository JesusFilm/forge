import type { SearchLanguageOption } from "./search-language"

function primaryLanguage(locale: string): string | null {
  try {
    return new Intl.Locale(locale).language.toLowerCase()
  } catch {
    return null
  }
}

export type SearchLanguageNameUsage =
  | "standalone"
  | "search-prepositional"
  | "catalog-identity"

function russianPrepositionalWord(word: string): string {
  if (/(?:ий|ый|ой)$/u.test(word)) return `${word.slice(0, -2)}ом`
  if (/ая$/u.test(word)) return `${word.slice(0, -2)}ой`
  if (/яя$/u.test(word)) return `${word.slice(0, -2)}ей`
  if (/ое$/u.test(word)) return `${word.slice(0, -2)}ом`
  if (/ее$/u.test(word)) return `${word.slice(0, -2)}ем`
  if (word === "письмо") return "письме"
  if (/ь$/u.test(word)) return `${word.slice(0, -1)}и`
  if (/[^аеёиоуыэюяйь]$/iu.test(word)) return `${word}е`
  return word
}

function russianPrepositionalLanguageName(name: string): string {
  if (!/\p{Script=Cyrillic}/u.test(name)) return name
  const reviewedCompounds: Readonly<Record<string, string>> = {
    "бразильский португальский": "бразильском португальском",
    "китайский, традиционное письмо": "китайском, традиционном письме",
    "китайский, упрощенное письмо": "китайском, упрощенном письме",
  }
  const reviewed = reviewedCompounds[name.toLocaleLowerCase("ru")]
  if (reviewed) return reviewed
  if (/[,()\s]/u.test(name)) return name
  return name.replace(/\p{L}+/gu, russianPrepositionalWord)
}

function contextualLanguageName(
  name: string,
  uiLocale: string,
  usage: SearchLanguageNameUsage,
): string {
  if (usage === "search-prepositional" && primaryLanguage(uiLocale) === "ru") {
    return russianPrepositionalLanguageName(name)
  }
  return name
}

export function localizedSearchLanguageName(
  option: SearchLanguageOption | null | undefined,
  uiLocale: string,
  fallback: string,
  usage: SearchLanguageNameUsage = "standalone",
): string {
  // Recovery copy names an exact catalog selection. ICU collapses some
  // three-letter catalog tags into their two-letter alias (fra -> fr), which
  // drops the provider's qualifier ("French, African"). Keep the provider name
  // ONLY when ICU really aliased the tag AND the provider name is ICU's name
  // plus extra words. Un-aliased tags (de, es-ES, pt, zh) and pure synonyms
  // (Adygey/Adyghe) keep localizing; other usages are unchanged.
  if (usage === "catalog-identity" && option?.englishName && option.bcp47) {
    try {
      const canonicalTag = Intl.getCanonicalLocales(option.bcp47)[0]
      if (canonicalTag?.toLowerCase() !== option.bcp47.toLowerCase()) {
        const canonicalEnglish = new Intl.DisplayNames(["en"], {
          type: "language",
        }).of(option.bcp47)
        const words = (value: string) =>
          value.toLocaleLowerCase("en").match(/\p{L}+/gu) ?? []
        const providerWords = new Set(words(option.englishName))
        const canonicalWords = words(canonicalEnglish ?? "")
        if (
          canonicalWords.length > 0 &&
          canonicalWords.every((word) => providerWords.has(word)) &&
          providerWords.size > new Set(canonicalWords).size
        ) {
          return option.englishName
        }
      }
    } catch {
      // Unknown tag: fall through to the normal localization path.
    }
  }

  if (option?.bcp47) {
    try {
      const displayNames = new Intl.DisplayNames([uiLocale], {
        type: "language",
      })
      const requestedUiLanguage = primaryLanguage(uiLocale)
      const resolvedUiLanguage = primaryLanguage(
        displayNames.resolvedOptions().locale,
      )
      const localizedName = displayNames.of(option.bcp47)?.trim()
      const targetLanguage = primaryLanguage(option.bcp47)
      const normalizedName = localizedName?.toLocaleLowerCase() ?? ""
      const codeLikeName = /^[a-z]{2,3}(?:[-_][a-z0-9]+)*(?:\s*\([^)]+\))?$/iu

      if (
        localizedName &&
        requestedUiLanguage === resolvedUiLanguage &&
        normalizedName !== option.bcp47.toLocaleLowerCase() &&
        normalizedName !== targetLanguage &&
        !codeLikeName.test(localizedName)
      ) {
        return contextualLanguageName(localizedName, uiLocale, usage)
      }
    } catch {
      // Fall through to provider-owned language names for unknown tags.
    }
  }

  return contextualLanguageName(
    option?.nativeName ?? option?.englishName ?? fallback,
    uiLocale,
    usage,
  )
}
