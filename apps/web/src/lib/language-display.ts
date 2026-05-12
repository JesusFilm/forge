// Strapi exposes one Language.name per language, which is sometimes the
// canonical English form ("A-Hmao", "A Che", "Achi, Rabinal") and sometimes
// the native form ("Адыгэбзэ", "Shqip", "Français", "ʿAfár af"). The
// arclight-backed watch-modern app has separate englishName + nativeName
// fields and renders them as primary + subtitle; we can approximate that by
// deciding, per row, whether Strapi's `name` IS the English form (in which
// case use it verbatim) or whether it's the native form (in which case
// title-case the slug as the English primary and surface `name` as the
// subtitle).
//
// Heuristic — `name` is the native form when EITHER:
//   1. it contains any non-ASCII character (e.g. "Адыгэбзэ", "ʿAfár af",
//      "Français", "اللغة العربية"), OR
//   2. its ASCII letters (lowercased, diacritics stripped) contain at least
//      one letter that does not appear in the slug's letters (e.g. slug
//      "albanian" / name "Shqip" — q is not in the slug).
// Otherwise `name` is just a formatted-up version of the slug ("A-Hmao",
// "Achi, Rabinal") and we use it directly.

export type LanguageDisplay = {
  slug: string
  name: string
  nativeName: string | null
}

const HYPHEN_SPLIT = /-+/
const COMBINING_DIACRITICS = /[̀-ͯ]/g
// Detect characters outside printable ASCII (space U+0020 through tilde
// U+007E). Catches Cyrillic, CJK, Arabic, precomposed Latin diacritics, and
// uncommon punctuation like the ʿ glyph (U+02BF).
const NON_ASCII = /[^ -~]/

export function titleCaseSlug(slug: string): string {
  return slug
    .split(HYPHEN_SPLIT)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ")
}

function asciiLetters(s: string): string {
  return s
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
}

function nameIsNativeForm(slug: string, name: string): boolean {
  if (NON_ASCII.test(name)) return true
  const slugLetters = new Set(asciiLetters(slug))
  for (const ch of asciiLetters(name)) {
    if (!slugLetters.has(ch)) return true
  }
  return false
}

export function deriveLanguageDisplay(
  slug: string,
  rawName: string | null | undefined,
): LanguageDisplay {
  const trimmed = rawName?.trim() ?? ""
  if (!trimmed) {
    return { slug, name: titleCaseSlug(slug), nativeName: null }
  }
  if (!nameIsNativeForm(slug, trimmed)) {
    // Strapi's name is a richer formatting of the slug — preserve it.
    return { slug, name: trimmed, nativeName: null }
  }
  // Strapi's name is the native form. Show slug-derived English as primary,
  // native as subtitle.
  const english = titleCaseSlug(slug)
  if (english === trimmed) {
    return { slug, name: english, nativeName: null }
  }
  return { slug, name: english, nativeName: trimmed }
}
