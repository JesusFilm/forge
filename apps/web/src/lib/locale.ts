import {
  AVAILABLE_UI_LOCALES,
  DEFAULT_LOCALE,
  hasUiLocale,
  type UiLocale,
} from "../i18n/generated-ui-locales"
import { LANGUAGE_BCP47_MAP } from "./language-bcp47-map"

export {
  AVAILABLE_UI_LOCALES,
  DEFAULT_LOCALE,
  hasUiLocale,
  type UiLocale,
} from "../i18n/generated-ui-locales"

/**
 * Query-param sentinel that signals "this URL's locale has already been
 * resolved server-side; do not re-apply the cookie-driven language
 * redirect for this request." Used as the contract between three sites:
 *
 *   1. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — sets it
 *      on the server redirect when the requested audio slug has no matching
 *      dub and the resolver falls back to a different variant.
 *   2. `apps/web/src/proxy.ts` — preserves it while canonicalizing and
 *      rewriting public URLs into the internal locale tree.
 *   3. `apps/web/src/components/watch/{WatchPageClient,SeriesPageClient}.tsx`
 *      — strips the param via `history.replaceState` after hydration
 *      so the user-visible URL stays clean.
 *
 * Renaming the param requires editing all four sites in lockstep;
 * exporting one constant makes the contract explicit and grep-able.
 */
export const LOCALE_RESOLVED_PARAM = "_lr"

export function isLocale(param: string): param is UiLocale {
  return hasUiLocale(param)
}

/**
 * Bcp47-or-English-name-slug check for the watch URL space. Returns true
 * for both generated UI catalog keys (`en`, `es`, `fr`) AND English-name
 * kebab slugs (`portuguese-brazil`, `spanish-castilian`).
 *
 * Use this — not `isLocale` — at user-facing URL boundaries where a
 * legacy English-name slug must be recognized as a language identifier
 * (e.g. distinguishing `/watch/russian.html` from `/watch/easter.html`).
 *
 * See [docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md]
 * — `isLocale()` alone silently normalized `spanish-castilian` to
 * `DEFAULT_LOCALE`; this widened check is the replacement at all
 * user-facing slug-form boundaries.
 */
export function isLocaleSlug(param: string): boolean {
  if (isLocale(param)) return true
  // English-name kebab heuristic. Multi-segment kebab (`portuguese-brazil`)
  // is unambiguously a language slug shape; single-token bare slugs like
  // `russian` collide with content slugs and require admin-corpus check,
  // which isn't wired yet. Conservative: only multi-segment slugs pass
  // the heuristic. Tightening to "exact admin corpus match" is Phase 4.
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(param)
}

/** Parse the primary locale from an Accept-Language header value. */
export function parseAcceptLanguage(
  acceptLanguage: string | null,
): UiLocale | null {
  if (!acceptLanguage) return null
  const requested = acceptLanguage.split(",")[0]?.trim()
  return requested ? resolveUiLocale(requested) : null
}

const HTML_LANG_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  // Admin's generated Language.bcp47 corpus does not currently include this
  // public audio slug, but the URL contract does. Keep the raw dub slug in
  // the path while allowing the static root layout to emit the regional SEO
  // tag instead of collapsing <html lang> to plain "es".
  "spanish-latin-american": "es-419",
})

const PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE: Readonly<
  Record<string, string>
> = Object.freeze({
  en: "english",
  es: "spanish-castilian",
  fr: "french",
  pt: "portuguese-brazil",
  de: "german-standard",
  ar: "arabic-modern-standard",
  id: "indonesian-isa",
  ja: "japanese",
  ko: "korean",
  ms: "malay",
  ne: "nepali",
  ru: "russian",
  th: "thai",
  tl: "tagalog",
  tr: "turkish",
  vi: "vietnamese",
  zh: "mandarin-china",
  "zh-Hans": "chinese-simplified",
  "zh-Hant": "chinese-traditional",
})

const BCP47_TAG_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i
const PUBLIC_LANGUAGE_SLUG_PATTERN = /^[a-z0-9-]+$/

const PUBLIC_WATCH_LANGUAGE_SLUG_ENTRIES: ReadonlyArray<
  readonly [string, string]
> = Object.freeze(
  [
    ...Object.entries(LANGUAGE_BCP47_MAP),
    ...Object.entries(HTML_LANG_OVERRIDES),
  ].sort(([a], [b]) => a.localeCompare(b)),
)

export function normalizeBcp47Tag(tag: string): string {
  return tag
    .split("-")
    .map((part, index) => {
      if (index === 0) return part.toLowerCase()
      if (/^[a-z]{4}$/i.test(part)) {
        return part[0]?.toUpperCase() + part.slice(1).toLowerCase()
      }
      if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase()
      return part.toLowerCase()
    })
    .join("-")
}

type LocaleTextDirection = "ltr" | "rtl"

type LocaleTextInfo = Readonly<{
  direction: LocaleTextDirection
}>

type LocaleWithTextInfo = Intl.Locale & {
  readonly textInfo?: LocaleTextInfo
  getTextInfo?: () => LocaleTextInfo
}

export function textDirectionForLocale(locale: string): LocaleTextDirection {
  try {
    const resolvedLocale = new Intl.Locale(locale) as LocaleWithTextInfo
    const textInfo =
      typeof resolvedLocale.getTextInfo === "function"
        ? resolvedLocale.getTextInfo()
        : resolvedLocale.textInfo

    return textInfo?.direction === "rtl" ? "rtl" : "ltr"
  } catch {
    const primaryLocale = locale.split("-")[0]
    if (primaryLocale && primaryLocale !== locale) {
      return textDirectionForLocale(primaryLocale)
    }
    return "ltr"
  }
}

export function slugToBcp47Tag(slug: string): string | null {
  if (Object.hasOwn(HTML_LANG_OVERRIDES, slug)) {
    return normalizeBcp47Tag(HTML_LANG_OVERRIDES[slug])
  }
  if (Object.hasOwn(LANGUAGE_BCP47_MAP, slug)) {
    return normalizeBcp47Tag(LANGUAGE_BCP47_MAP[slug])
  }
  // Accept bcp47 input directly (e.g. URL contains "es-419" not an
  // English-name language slug). This is used only for the internal
  // [htmlLang] segment and locale-family verification.
  if (BCP47_TAG_PATTERN.test(slug)) return normalizeBcp47Tag(slug)
  return null
}

/**
 * Resolve an English-name language slug (`spanish-castilian`,
 * `portuguese-brazil`) to its BCP-47 primary subtag (`es`, `pt`).
 *
 * Two-step lookup:
 *   1. `LANGUAGE_BCP47_MAP` (codegen'd from admin's Language.bcp47) →
 *      full BCP-47 tag, e.g. `spanish-castilian → es-ES`.
 *   2. `split("-")[0]` → primary subtag per RFC 5646.
 *
 * This helper intentionally reports the audio/content language's BCP-47
 * primary. UI catalog fallback is handled by `resolveUiLocale`, which
 * checks generated message catalog availability before choosing chrome.
 *
 * Returns null when the slug isn't a recognized admin Language slug
 * (or when admin's row has no BCP-47 — 39 obscure languages today).
 *
 * Examples:
 *   slugToBcp47Primary("spanish-castilian") → "es"
 *   slugToBcp47Primary("portuguese-brazil") → "pt"
 *   slugToBcp47Primary("mandarin-china")    → "zh"
 *   slugToBcp47Primary("english")           → "en"
 *   slugToBcp47Primary("en")                → "en"   // also accepts bcp47 input
 *   slugToBcp47Primary("not-a-language")    → null
 */
export function slugToBcp47Primary(slug: string): string | null {
  const bcp47 = slugToBcp47Tag(slug)
  return bcp47?.split("-")[0]?.toLowerCase() ?? null
}

/**
 * Public watch content URLs accept English-name audio slugs only
 * (`english`, `spanish-castilian`, `swahili`), never BCP-47 route/catalog
 * keys (`en`, `pt-br`). This is deliberately narrower than
 * `slugToBcp47Tag`, which still accepts BCP-47 for the internal [htmlLang]
 * segment.
 */
export function isPublicWatchLanguageSlug(slug: string): boolean {
  if (!PUBLIC_LANGUAGE_SLUG_PATTERN.test(slug)) return false
  return (
    Object.hasOwn(LANGUAGE_BCP47_MAP, slug) ||
    Object.hasOwn(HTML_LANG_OVERRIDES, slug)
  )
}

export function isPublicWatchHomeLanguageSlug(slug: string): boolean {
  return isPublicWatchLanguageSlug(slug)
}

function inferredPublicWatchLanguageSlugForLocale(
  locale: string,
): string | null {
  const normalizedLocale = normalizeBcp47Tag(locale)
  for (const [slug, bcp47] of PUBLIC_WATCH_LANGUAGE_SLUG_ENTRIES) {
    if (normalizeBcp47Tag(bcp47) === normalizedLocale) return slug
  }
  return null
}

export function publicWatchAudioLanguageSlugForLocale(
  locale: string,
): string | null {
  if (Object.hasOwn(PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE, locale)) {
    return PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE[locale]
  }
  return inferredPublicWatchLanguageSlugForLocale(locale)
}

export function publicWatchHomeLanguageSlugForLocale(
  locale: string,
): string | null {
  return publicWatchAudioLanguageSlugForLocale(locale)
}

// Narrow ISO 639-3 → ISO 639-1 fallback for common UI catalog families.
// Admin's Language.bcp47 sometimes carries the 3-letter ISO 639-3 code
// instead of the 2-letter 639-1 (e.g. `french-african` → `fra`,
// `english-african` → `eng`). Only return one of these aliases when that
// catalog actually exists in the generated message list.
const ISO_639_3_TO_UI_LOCALE: Readonly<Record<string, string>> = Object.freeze({
  eng: "en",
  spa: "es",
  fra: "fr",
  por: "pt",
  deu: "de",
  ger: "de", // legacy ISO 639-2/B alternative
  fil: "tl",
  tgl: "tl",
  nep: "ne",
  npi: "ne",
})

function bcp47FallbackCandidates(tag: string): string[] {
  const parts = normalizeBcp47Tag(tag).split("-")
  const candidates: string[] = []
  for (let length = parts.length; length >= 1; length -= 1) {
    candidates.push(parts.slice(0, length).join("-"))
  }
  return [...new Set(candidates)]
}

/**
 * Testable catalog-driven resolver. Production calls `resolveUiLocale`,
 * which supplies the generated message catalog list.
 */
export function resolveUiLocaleForCatalog(
  localeSegment: string,
  catalogs: readonly string[],
): string | null {
  const catalogSet = new Set(catalogs)
  if (catalogSet.has(localeSegment)) return localeSegment

  const tag = slugToBcp47Tag(localeSegment)
  if (!tag) return null

  for (const candidate of bcp47FallbackCandidates(tag)) {
    if (catalogSet.has(candidate)) return candidate
  }

  const primary = tag.split("-")[0]?.toLowerCase()
  if (primary && Object.hasOwn(ISO_639_3_TO_UI_LOCALE, primary)) {
    const alias = ISO_639_3_TO_UI_LOCALE[primary]
    if (alias && catalogSet.has(alias)) return alias
  }

  return null
}

/**
 * Normalize a URL locale segment (slug-form OR bcp47) to an available UI
 * message catalog. Returns null when no generated catalog matches; callers
 * that render watch chrome fall back to `DEFAULT_LOCALE`.
 *
 * Examples with current catalogs:
 *   resolveUiLocale("spanish-castilian") → "es"
 *   resolveUiLocale("portuguese-mozambique") → "pt"
 *   resolveUiLocale("mandarin-china") → "zh"
 *   resolveUiLocale("russian") → "ru"
 *
 * Languages without a matching generated catalog return null here; watch
 * chrome callers fall back to `DEFAULT_LOCALE`.
 */
export function resolveUiLocale(localeSegment: string): UiLocale | null {
  const resolved = resolveUiLocaleForCatalog(
    localeSegment,
    AVAILABLE_UI_LOCALES,
  )
  return resolved && isLocale(resolved) ? resolved : null
}

export type WatchLocaleIdentity = {
  /** Internal [locale] segment and next-intl message catalog key. */
  locale: UiLocale
  /** Internal [htmlLang] segment used by the root layout's static <html lang>. */
  htmlLang: string
}

const WATCH_LOCALE_IDENTITY_OVERRIDES: Readonly<
  Record<string, WatchLocaleIdentity>
> = Object.freeze({
  // Admin exposes Hassaniyya through the extlang-style `ar-mey` tag, while
  // the UI inventory owns an explicit Latin-script catalog. Keep that
  // intentional provisional catalog reachable instead of collapsing to `ar`.
  "arabic-hassaniya": { locale: "mey-Latn", htmlLang: "mey-Latn" },
  "ar-mey": { locale: "mey-Latn", htmlLang: "mey-Latn" },
})

export function resolveWatchLocaleIdentity(
  localeSegment: string | null | undefined,
): WatchLocaleIdentity {
  if (!localeSegment) {
    return { locale: DEFAULT_LOCALE, htmlLang: DEFAULT_LOCALE }
  }
  const override = WATCH_LOCALE_IDENTITY_OVERRIDES[localeSegment]
  if (override) return override
  const locale = resolveUiLocale(localeSegment) ?? DEFAULT_LOCALE
  const tag = slugToBcp47Tag(localeSegment)
  const htmlLang = tag && resolveUiLocale(tag) === locale ? tag : locale
  return { locale, htmlLang }
}
