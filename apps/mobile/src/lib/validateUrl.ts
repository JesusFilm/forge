const ALLOWED_STREAMING_HOSTS = new Set(["stream.mux.com"])

const BLOCKED_SCHEMES = new Set([
  "javascript:",
  "data:",
  "tel:",
  "sms:",
  "file:",
  "ftp:",
])

/**
 * Normalize a CMS-sourced stream URL before validation/playback: trim outer
 * whitespace and reject any interior whitespace. WHATWG URL parsing silently
 * strips both, so a tainted value passes validation but 400s at the player.
 */
export function cleanStreamUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  return trimmed
}

/**
 * Validate a streaming URL before passing to useVideoPlayer().
 * Only allows Mux streaming domains.
 */
export function validateStreamingUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return ALLOWED_STREAMING_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Validate a CMS-sourced action URL before opening with Linking.openURL().
 * Requires https: protocol. Rejects dangerous schemes.
 */
export function validateActionUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)

    // Block dangerous schemes
    if (BLOCKED_SCHEMES.has(parsed.protocol)) return false

    // Require https (allow http only in dev)
    if (parsed.protocol === "https:") return true
    if (__DEV__ && parsed.protocol === "http:") return true

    return false
  } catch {
    return false
  }
}
