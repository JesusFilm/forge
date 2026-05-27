const WATCH_CALLBACK_ALLOWED_HOSTS = new Set([
  "jesusfilm.org",
  "www.jesusfilm.org",
  "web.jesusfilm.org",
  "localhost",
  "127.0.0.1",
])

const BLOCKED_CALLBACK_PARAM_NAMES = new Set(["downloadUrl", "mediaUrl", "url"])

function hasBlockedDownloadReference(url: URL): boolean {
  for (const [name, value] of url.searchParams.entries()) {
    if (BLOCKED_CALLBACK_PARAM_NAMES.has(name)) return true
    if (/stream\.mux\.com|image\.mux\.com/i.test(value)) return true
  }
  return false
}

function hasAllowedProtocol(url: URL): boolean {
  if (url.protocol === "https:") return true
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  )
}

export function resolveWatchCallbackURL(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }

  if (!WATCH_CALLBACK_ALLOWED_HOSTS.has(url.hostname)) return undefined
  if (!hasAllowedProtocol(url)) return undefined
  if (!url.pathname.startsWith("/watch/")) return undefined
  if (url.pathname.startsWith("/watch/api/")) return undefined
  if (url.pathname.startsWith("/api/")) return undefined
  if (hasBlockedDownloadReference(url)) return undefined

  return url.toString()
}
