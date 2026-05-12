// Strapi's Language.name field is inconsistent — some entries store the
// English name ("Arabic, Sudanese Spoken"), some store the native form
// ("Français", "اللغة العربية"). For the language picker we want:
//   - Primary text: an English-form label
//   - Subtitle:     the language's name in its own script, when distinct
// Until Strapi exposes a separate englishName field, we derive the English
// label from the slug (kebab → Title Case) and keep `name` as the native
// candidate. If the two are equivalent (after normalising punctuation and
// case), we suppress the duplicate subtitle.

export type LanguageDisplay = {
  slug: string
  name: string
  nativeName: string | null
}

export function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) =>
      word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1),
    )
    .join(" ")
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function deriveLanguageDisplay(
  slug: string,
  rawName: string | null | undefined,
): LanguageDisplay {
  const english = titleCaseSlug(slug)
  const trimmed = rawName?.trim() ?? ""
  if (!trimmed) return { slug, name: english, nativeName: null }
  if (normalize(english) === normalize(trimmed)) {
    return { slug, name: english, nativeName: null }
  }
  return { slug, name: english, nativeName: trimmed }
}
