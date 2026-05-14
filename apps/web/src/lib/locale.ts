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

/** Parse the primary locale from an Accept-Language header value. */
export function parseAcceptLanguage(
  acceptLanguage: string | null,
): (typeof SUPPORTED_LOCALES)[number] | null {
  if (!acceptLanguage) return null
  const primary = acceptLanguage.split(",")[0]?.split("-")[0]?.trim()
  if (primary && isLocale(primary)) return primary
  return null
}
