export const LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function writePreferredLanguageSlug(slug: string): void {
  if (typeof document === "undefined") return
  const secure = process.env.NODE_ENV === "production" ? "; secure" : ""
  document.cookie = `${LANGUAGE_PREFERENCE_COOKIE}=${encodeURIComponent(slug)}; path=/watch; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`
}
