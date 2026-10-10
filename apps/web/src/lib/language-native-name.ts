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
 * is the same string as the English name (nothing native to show).
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
