export const DEFAULT_LOCALE = "en"

export const SUPPORTED_LOCALES = ["en", "es", "fr", "pt", "de"] as const

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
): param is (typeof SUPPORTED_LOCALES)[number] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(param)
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
): (typeof SUPPORTED_LOCALES)[number] | null {
  if (!acceptLanguage) return null
  const primary = acceptLanguage.split(",")[0]?.split("-")[0]?.trim()
  if (primary && isLocale(primary)) return primary
  return null
}
