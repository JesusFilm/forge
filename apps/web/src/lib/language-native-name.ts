import {
  isDeclarableHtmlLangTag,
  normalizeBcp47Tag,
  textDirectionForLocale,
} from "@/lib/locale"

/**
 * Native (own-language) names for Watch language pickers (FGE-50).
 *
 * Admin's language `name` map is built by core sync's `toNameMap`, which keys
 * every entry by the TRANSLATION language's own BCP 47 tag
 * (`{ en: "French", de: "Französisch", fr: "Français" }`). The only entry that
 * is guaranteed to be the language's endonym is the one keyed by the
 * language's own tag, so that is the only one selected here. Object order,
 * `native` / `local` keys and "any non-English value" are not evidence.
 */

export type NativeLanguageName = {
  text: string
  /**
   * Verified declarable BCP 47 tag of `text`, script preserved. Null when the
   * matched key is not a tag this app is willing to declare; the text is still
   * the language's own name, it just stays untagged.
   */
  lang: string | null
}

export type DeclaredLanguageAttributes = {
  lang: string
  dir: "ltr" | "rtl"
}

function primarySubtag(tag: string): string {
  return tag.split("-")[0] ?? tag
}

function normalizedTag(tag: string): string {
  return normalizeBcp47Tag(tag.trim().replaceAll("_", "-"))
}

function likelyScript(tag: string): string | null {
  try {
    return new Intl.Locale(tag).maximize().script ?? null
  } catch {
    return null
  }
}

/**
 * Whether the primary-subtag form of `tag` is written in the same script as
 * `tag` itself. `ku` maximizes to `ku-Latn`, so a `ku` entry is not the name of
 * `ku-Arab`; `zh` maximizes to `zh-Hans`, so it is not the name of `zh-Hant`.
 * A tag with no subtags beyond the primary trivially matches itself. An
 * unparseable tag never matches.
 */
export function primaryTagMatchesScript(tag: string): boolean {
  const full = normalizedTag(tag)
  const primary = primarySubtag(full)
  if (!primary) return false
  if (full === primary) return true
  const fullScript = likelyScript(full)
  const primaryScript = likelyScript(primary)
  return fullScript != null && fullScript === primaryScript
}

// ISO 15924 codes that are not Unicode scripts, mapped to the Unicode scripts
// their text is written in. Every other code is tried as a Unicode Script
// alias (`Latn`, `Cyrl`, `Arab`, `Mong`...).
const COMPOSITE_SCRIPTS: Record<string, readonly string[]> = {
  Hans: ["Han"],
  Hant: ["Han"],
  Hanb: ["Han", "Bopomofo"],
  Jpan: ["Han", "Hiragana", "Katakana"],
  Kore: ["Hangul", "Han"],
}

function scriptPatterns(isoScript: string): RegExp[] | null {
  try {
    return (COMPOSITE_SCRIPTS[isoScript] ?? [isoScript]).map(
      (script) => new RegExp(`\\p{Script=${script}}`, "u"),
    )
  } catch {
    return null
  }
}

/**
 * Whether `text` is written in the script `bcp47` is written in. Core's name
 * records sometimes hold a name in another script than the one the site writes
 * the language in (Malay in Jawi, Tajik in Arabic script, Mongolian in
 * traditional Mongolian). Showing such a name as the language's own mislabels
 * it, so callers drop it and fall back to a derived name or none.
 *
 * The expected script is the tag's explicit script, else its likely script
 * (`Intl.Locale.maximize()`). Fails open: an unknown tag or script, or text
 * with no letters, is never rejected. The text must be at least half letters
 * of the expected script, so a name that mixes a few Latin letters into native
 * script survives.
 */
export function nativeNameMatchesLanguageScript(
  text: string,
  bcp47: string | null | undefined,
): boolean {
  if (!bcp47?.trim()) return true
  const expected = likelyScript(normalizedTag(bcp47))
  if (!expected) return true
  const patterns = scriptPatterns(expected)
  if (!patterns) return true
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return true
  const matching = letters.filter((letter) =>
    patterns.some((pattern) => pattern.test(letter)),
  )
  return matching.length * 2 >= letters.length
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function entryForTag(
  names: Record<string, unknown>,
  tag: string,
): string | null {
  for (const [key, value] of Object.entries(names)) {
    if (normalizedTag(key) !== tag) continue
    const text = nonEmptyString(value)
    if (text) return text
  }
  return null
}

/**
 * Select the language's own name from its name map: the entry keyed by the
 * normalized own tag, else the primary-subtag entry when it shares the full
 * tag's script. Returns null when there is no own-language entry, or when it
 * is the same string as the English name (nothing native to show), or is
 * written in a different script than the language (see
 * `nativeNameMatchesLanguageScript`).
 */
export function selectOwnLanguageName(
  names: unknown,
  bcp47: string | null | undefined,
): NativeLanguageName | null {
  if (!bcp47?.trim()) return null
  if (typeof names !== "object" || names === null || Array.isArray(names)) {
    return null
  }
  const map = names as Record<string, unknown>
  const own = normalizedTag(bcp47)
  const primary = primarySubtag(own)

  let matchedTag = own
  let text = entryForTag(map, own)
  if (!text && primary && primary !== own && primaryTagMatchesScript(own)) {
    matchedTag = primary
    text = entryForTag(map, primary)
  }
  if (!text) return null
  if (text === nonEmptyString(map.en)) return null
  if (!nativeNameMatchesLanguageScript(text, own)) return null

  return { text, lang: isDeclarableHtmlLangTag(matchedTag) ? matchedTag : null }
}

/**
 * Declarable tag for a label produced by `Intl.DisplayNames([primary])`. That
 * label is in the PRIMARY language only, so it is tagged with the primary
 * subtag, and only when the primary shares the source tag's script (a `ku-Arab`
 * row must not tag Latin-script `kurdî`).
 */
export function derivedNativeNameLang(
  bcp47: string | null | undefined,
): string | null {
  if (!bcp47?.trim()) return null
  const full = normalizedTag(bcp47)
  const primary = primarySubtag(full)
  if (!primary || !primaryTagMatchesScript(full)) return null
  return isDeclarableHtmlLangTag(primary) ? primary : null
}

/**
 * Markup attributes for a verified tag. Re-checks declarability so a tag that
 * arrives through a prop is never trusted blindly; script is preserved
 * (`ku-Arab` stays `ku-Arab` and resolves rtl).
 */
export function declaredLanguageAttributes(
  lang: string | null | undefined,
): DeclaredLanguageAttributes | null {
  if (!lang?.trim()) return null
  const tag = normalizedTag(lang)
  if (!isDeclarableHtmlLangTag(tag)) return null
  return { lang: tag, dir: textDirectionForLocale(tag) }
}
