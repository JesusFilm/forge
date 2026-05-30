export type LanguageDisplay = {
  slug: string
  name: string
  nativeName: string | null
}

const HYPHEN_SPLIT = /-+/
const COMBINING_DIACRITICS = /[̀-ͯ]/g
const NON_ASCII = /[^ -~]/

function titleCaseSlug(slug: string): string {
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
  const slugAscii = asciiLetters(slug)
  const nameAscii = asciiLetters(name)
  if (slugAscii && nameAscii && slugAscii[0] !== nameAscii[0]) return true
  const slugLetters = new Set(slugAscii)
  for (const ch of nameAscii) {
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
    return { slug, name: trimmed, nativeName: null }
  }
  const english = titleCaseSlug(slug)
  if (english === trimmed) {
    return { slug, name: english, nativeName: null }
  }
  return { slug, name: english, nativeName: trimmed }
}
