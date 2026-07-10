export const PRODUCTION_WATCH_CALLBACK_ORIGINS = [
  "https://jesusfilm.org",
  "https://www.jesusfilm.org",
  "https://watch.jesusfilm.org",
] as const

export const LOCAL_WATCH_CALLBACK_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3020",
  "http://127.0.0.1:3020",
  "http://localhost:3030",
  "http://127.0.0.1:3030",
  "http://localhost:3102",
  "http://127.0.0.1:3102",
] as const

export const SAFE_DOWNLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
])

const BLOCKED_CALLBACK_PARAM_NAMES = new Set(["downloadurl", "mediaurl", "url"])
const BLOCKED_MEDIA_REFERENCE_PATTERN = /stream\.mux\.com|image\.mux\.com/i

export function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function getDefaultWatchCallbackOrigins(
  nodeEnv: string | undefined,
): string[] {
  return nodeEnv === "production"
    ? [...PRODUCTION_WATCH_CALLBACK_ORIGINS]
    : [...PRODUCTION_WATCH_CALLBACK_ORIGINS, ...LOCAL_WATCH_CALLBACK_ORIGINS]
}

export function isAllowedDownloadOrigin(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  if (parsed.protocol !== "https:") return false

  const host = parsed.hostname
  return (
    host === "jesusfilm.org" ||
    host.endsWith(".jesusfilm.org") ||
    host === "stream.mux.com" ||
    host.endsWith(".mux.com")
  )
}

function hasBlockedDownloadReference(url: URL): boolean {
  for (const [name, value] of url.searchParams.entries()) {
    if (BLOCKED_CALLBACK_PARAM_NAMES.has(name.toLowerCase())) return true
    if (isAllowedDownloadOrigin(value)) return true
    if (BLOCKED_MEDIA_REFERENCE_PATTERN.test(value)) return true
  }
  return false
}

export function resolveWatchCallbackURL(
  value: string | null | undefined,
  allowedOrigins: readonly string[],
): string | undefined {
  if (!value) return undefined

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }

  const normalizedAllowedOrigins = new Set(
    allowedOrigins
      .map(normalizeOrigin)
      .filter((origin): origin is string => origin != null),
  )
  if (!normalizedAllowedOrigins.has(url.origin)) return undefined
  if (!url.pathname.startsWith("/watch/")) return undefined
  if (url.pathname.startsWith("/watch/api/")) return undefined
  if (url.pathname.startsWith("/api/")) return undefined
  if (hasBlockedDownloadReference(url)) return undefined

  return url.toString()
}
