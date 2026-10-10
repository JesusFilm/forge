export const SUBTITLE_PREFERENCE_COOKIE = "forge_watch_subs"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const EXPLICIT_SUBTITLE_PREFERENCE_PREFIX = "v2:"

export function writeSubtitlePreference(
  enabled: boolean,
  languageSlug: string | null,
): void {
  if (typeof document === "undefined") return
  const value =
    enabled && languageSlug
      ? encodeURIComponent(
          `${EXPLICIT_SUBTITLE_PREFERENCE_PREFIX}${languageSlug}`,
        )
      : "off"
  const secure = process.env.NODE_ENV === "production" ? "; secure" : ""
  document.cookie = `${SUBTITLE_PREFERENCE_COOKIE}=${value}; path=/watch; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`
}

export function readSubtitlePreference(): {
  enabled: boolean
  languageSlug: string | null
  explicit: boolean
} {
  if (typeof document === "undefined")
    return { enabled: false, languageSlug: null, explicit: false }

  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${SUBTITLE_PREFERENCE_COOKIE}=`))

  if (!match) return { enabled: false, languageSlug: null, explicit: false }

  const raw = match.split("=").slice(1).join("=")
  if (!raw || raw === "off")
    return { enabled: false, languageSlug: null, explicit: false }

  const decoded = decodeURIComponent(raw)
  if (decoded.startsWith(EXPLICIT_SUBTITLE_PREFERENCE_PREFIX)) {
    const languageSlug = decoded.slice(
      EXPLICIT_SUBTITLE_PREFERENCE_PREFIX.length,
    )
    if (!languageSlug)
      return { enabled: false, languageSlug: null, explicit: false }
    return { enabled: true, languageSlug, explicit: true }
  }

  return { enabled: true, languageSlug: decoded, explicit: false }
}
