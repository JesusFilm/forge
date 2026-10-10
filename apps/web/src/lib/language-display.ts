// Admin's Language.name is a locale-keyed JSON map with an `en` entry on
// every language; `pickLocalizedName` in `content.ts` flattens it to that
// English name, and native names travel separately as `nativeName`. The name
// is the language studios' canonical label ("Urdu - C", "Awa (Papua New
// Guinea)", "Euskera") and is displayed verbatim.
//
// The slug is a URL key, not a label. It is title-cased only when no name is
// available (e.g. a language known by slug alone). Never derive a display name
// from the slug while a real name exists — the Strapi-era heuristic that did so
// relabelled 22 admin languages, "Urdu - C" as "Urdu Hoda" among them.

export type LanguageDisplay = {
  slug: string
  name: string
}

const HYPHEN_SPLIT = /-+/

export function titleCaseSlug(slug: string): string {
  return slug
    .split(HYPHEN_SPLIT)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ")
}

export function deriveLanguageDisplay(
  slug: string,
  rawName: string | null | undefined,
): LanguageDisplay {
  return { slug, name: rawName?.trim() || titleCaseSlug(slug) }
}

const FIRST_STRONG_ISOLATE = "\u2068"
const POP_DIRECTIONAL_ISOLATE = "\u2069"

/**
 * Wrap a language name in Unicode isolate marks before interpolating it into
 * a translated sentence. Without the isolate, an RTL name inside an LTR
 * message (or the reverse) reorders the surrounding words.
 *
 * Lives here rather than in the language-picker presentation module so the
 * always-loaded header chrome can label its inventory link without pulling
 * the picker bundle into the initial chunk.
 */
export function isolateLanguageName(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`
}
