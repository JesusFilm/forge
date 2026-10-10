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
  // Recovery copy names an exact catalog selection. ICU may omit a catalog
  // qualifier (fra canonicalizes to fr), so compare with its English name
  // before translating. Keep provider wording when it carries extra identity.
  // Other usages retain their existing localization behavior.
  if (usage === "catalog-identity" && option?.englishName && option.bcp47) {
    try {
      const canonicalEnglish = new Intl.DisplayNames(["en"], {
        type: "language",
      }).of(option.bcp47)
      const words = (value: string) =>
        value.toLocaleLowerCase("en").match(/\p{L}+/gu) ?? []
      const canonicalWords = new Set(words(canonicalEnglish ?? ""))
      if (words(option.englishName).some((word) => !canonicalWords.has(word))) {
        return option.englishName
      }
    } catch {
      return option.englishName
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
