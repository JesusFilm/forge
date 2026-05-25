export const SUBTITLE_PREFERENCE_COOKIE = "forge_watch_subs"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function writeSubtitlePreference(
  enabled: boolean,
  languageSlug: string | null,
): void {
  if (typeof document === "undefined") return
  const value =
    enabled && languageSlug ? encodeURIComponent(languageSlug) : "off"
  const secure = process.env.NODE_ENV === "production" ? "; secure" : ""
  document.cookie = `${SUBTITLE_PREFERENCE_COOKIE}=${value}; path=/watch; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`
}

export function readSubtitlePreference(): {
  enabled: boolean
  languageSlug: string | null
} {
  if (typeof document === "undefined")
    return { enabled: false, languageSlug: null }

  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${SUBTITLE_PREFERENCE_COOKIE}=`))

  if (!match) return { enabled: false, languageSlug: null }

  const raw = match.split("=").slice(1).join("=")
  if (!raw || raw === "off") return { enabled: false, languageSlug: null }

  return { enabled: true, languageSlug: decodeURIComponent(raw) }
}
