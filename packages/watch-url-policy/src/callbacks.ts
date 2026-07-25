import { isAllowedDownloadOrigin } from "./download"

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

const BLOCKED_CALLBACK_PARAM_NAMES = new Set(["downloadurl", "mediaurl", "url"])
const BLOCKED_MEDIA_REFERENCE_PATTERN = /stream\.mux\.com|image\.mux\.com/i
const ENCODED_PATH_SEPARATOR_PATTERN = /%2f|%5c/i

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

function hasBlockedDownloadReference(url: URL): boolean {
  let blocked = false
  url.searchParams.forEach((value, name) => {
    if (
      BLOCKED_CALLBACK_PARAM_NAMES.has(name.toLowerCase()) ||
      isAllowedDownloadOrigin(value) ||
      BLOCKED_MEDIA_REFERENCE_PATTERN.test(value)
    ) {
      blocked = true
    }
  })
  return blocked
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
  if (ENCODED_PATH_SEPARATOR_PATTERN.test(url.pathname)) return undefined
  if (url.pathname !== "/watch" && !url.pathname.startsWith("/watch/"))
    return undefined
  if (url.pathname.startsWith("/watch/api/")) return undefined
  if (url.pathname.startsWith("/api/")) return undefined
  if (hasBlockedDownloadReference(url)) return undefined

  return url.toString()
}
