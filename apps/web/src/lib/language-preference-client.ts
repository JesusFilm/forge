import { LANGUAGE_PREFERENCE_COOKIE } from "./language-preference-constants"

export { LANGUAGE_PREFERENCE_COOKIE }

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

// Cookie scope `path=/watch` must stay in sync with `basePath: "/watch"` in
// apps/web/next.config.mjs. If the basePath ever changes, this string must
// change with it — there is no compile-time link between the two.
export function writePreferredLanguageSlug(slug: string): void {
  if (typeof document === "undefined") return
  const secure = process.env.NODE_ENV === "production" ? "; secure" : ""
  document.cookie = `${LANGUAGE_PREFERENCE_COOKIE}=${encodeURIComponent(slug)}; path=/watch; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`
}
