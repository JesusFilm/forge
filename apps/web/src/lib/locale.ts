import { LANGUAGE_BCP47_MAP } from "./language-bcp47-map"

export const DEFAULT_LOCALE = "en"

// Internal type-narrowing tuple for `isLocale()`. The bcp47 primary
// subtags of the UI-locale families web supports. Must stay aligned with
// the filesystem-derived `AVAILABLE_UI_LOCALES` (apps/web/src/i18n/locales.ts):
// when a new `messages/{locale}.json` lands, widen this tuple in the
// same PR so `isLocale(locale)` recognizes it.
//
// Exported for the locale-parity test only — `apps/web/src/i18n/__tests__/messages-parity.test.ts`
// asserts UI_LOCALE_FAMILIES ⊆ AVAILABLE_UI_LOCALES so a dropped catalog
// fails CI. Outside the test, callers use `hasUiLocale` from
// `@/i18n/locales` for catalog membership, or `isLocale` from this file
// for bcp47 narrowing.
export const UI_LOCALE_FAMILIES = ["en", "es", "fr", "pt", "de"] as const

/**
 * Query-param sentinel that signals "this URL's locale has already been
 * resolved server-side; do not re-apply the cookie-driven language
 * redirect for this request." Used as the contract between three sites:
 *
 *   1. `apps/web/src/app/[slug]/[locale]/page.tsx` — sets it on the
 *      server redirect when the requested locale has no matching dub
 *      and the resolver falls back to a different variant.
 *   2. `apps/web/src/proxy.ts` — short-circuits
 *      `maybeRedirectToPreferredLanguage` when the param is present,
 *      breaking the redirect loop where the cookie would otherwise
 *      bounce the user back to the unmatched locale.
 *   3. `apps/web/src/components/watch/{WatchPageClient,SeriesPageClient}.tsx`
 *      — strips the param via `history.replaceState` after hydration
 *      so the user-visible URL stays clean.
 *
 * Renaming the param requires editing all four sites in lockstep;
 * exporting one constant makes the contract explicit and grep-able.
 */
export const LOCALE_RESOLVED_PARAM = "_lr"

export function isLocale(
  param: string,
): param is (typeof UI_LOCALE_FAMILIES)[number] {
  return (UI_LOCALE_FAMILIES as readonly string[]).includes(param)
}

/**
 * Bcp47-or-English-name-slug check for the watch URL space. Returns true
 * for both `en`/`es`/`fr` (bcp47, the UI template locales) AND English-name
 * kebab slugs (`russian`, `portuguese-brazil`, `spanish-castilian` — the
 * per-variant language slugs sourced from admin's `Language.slug` field).
 *
 * Today the kebab branch is a heuristic: any input containing a hyphen
 * with safe-slug characters is admitted. The full admin-corpus check
 * (Phase 4) will replace the heuristic with a precise enumeration once
 * the language list is wired through to the routing layer.
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
): (typeof UI_LOCALE_FAMILIES)[number] | null {
  if (!acceptLanguage) return null
  const primary = acceptLanguage.split(",")[0]?.split("-")[0]?.trim()
  if (primary && isLocale(primary)) return primary
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
 * Used at the watch route boundary to map a slug-form locale segment
 * (`/watch/jesus.html/spanish-castilian.html`) to a UI chrome locale
 * the rest of the app understands. Caller compares against
 * `UI_LOCALE_FAMILIES` and falls back to `DEFAULT_LOCALE` when the
 * primary subtag isn't one of the 5 UI template locales.
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
  if (Object.hasOwn(LANGUAGE_BCP47_MAP, slug)) {
    const bcp47 = LANGUAGE_BCP47_MAP[slug]
    return bcp47.split("-")[0] ?? null
  }
  // Accept bcp47 input directly (e.g. URL contains "en" not "english").
  // The slug map is keyed by English-name kebab slugs; bcp47 values like
  // "en", "es", "fr" don't appear as keys but ARE the desired output.
  // Detect by shape: lowercase 2-3 char primary subtag with no embedded
  // segment separators.
  if (/^[a-z]{2,3}$/.test(slug)) return slug
  return null
}

// Narrow ISO 639-3 → ISO 639-1 fallback for the 5 UI_LOCALE_FAMILIES
// families. Admin's Language.bcp47 sometimes carries the 3-letter ISO
// 639-3 code instead of the 2-letter 639-1 (e.g. `french-african` → `fra`,
// `english-african` → `eng`). Both encode the same UI-chrome language;
// without this table, the family fallback would null-out for those slugs.
// Only the UI_LOCALE_FAMILIES families need entries.
const ISO_639_3_TO_UI_LOCALE: Readonly<
  Record<string, (typeof UI_LOCALE_FAMILIES)[number]>
> = Object.freeze({
  eng: "en",
  spa: "es",
  fra: "fr",
  por: "pt",
  deu: "de",
  ger: "de", // legacy ISO 639-2/B alternative
})

/**
 * Normalize a URL locale segment (slug-form OR bcp47) to a UI chrome
 * locale that `isLocale()` accepts. Returns null when the locale can't
 * be mapped to one of the 5 UI_LOCALE_FAMILIES — caller falls back to
 * DEFAULT_LOCALE.
 *
 * Examples:
 *   resolveUiLocale("spanish-castilian") → "es"
 *   resolveUiLocale("portuguese-mozambique") → "pt"
 *   resolveUiLocale("mandarin-china") → null  // zh not in UI_LOCALE_FAMILIES
 *   resolveUiLocale("en") → "en"
 *   resolveUiLocale("russian") → null  // ru not in UI_LOCALE_FAMILIES
 */
export function resolveUiLocale(
  localeSegment: string,
): (typeof UI_LOCALE_FAMILIES)[number] | null {
  if (isLocale(localeSegment)) return localeSegment
  const primary = slugToBcp47Primary(localeSegment)
  if (!primary) return null
  if (isLocale(primary)) return primary
  // ISO 639-3 → 639-1 fallback for the UI_LOCALE_FAMILIES families.
  if (Object.hasOwn(ISO_639_3_TO_UI_LOCALE, primary)) {
    return ISO_639_3_TO_UI_LOCALE[primary]
  }
  return null
}
