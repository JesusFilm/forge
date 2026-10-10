import { SEARCH_LANGUAGE_PREFERENCE_COOKIE } from "./search-language-preference-constants"

export { SEARCH_LANGUAGE_PREFERENCE_COOKIE }

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function writeSearchLanguagePreferenceSlug(slug: string): void {
  if (typeof document === "undefined") return
  const secure = process.env.NODE_ENV === "production" ? "; secure" : ""
  document.cookie = `${SEARCH_LANGUAGE_PREFERENCE_COOKIE}=${encodeURIComponent(slug)}; path=/watch; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`
}
