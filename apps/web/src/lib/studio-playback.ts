/** Identifies revocable resources by the canonical route, including URLs held
 * by an older cached card. This is routing, never an authorization decision. */
export function isStudioPlaybackUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    let path = new URL(value, "https://relative.invalid").pathname
    for (let i = 0; i < 4; i++) {
      if (/^\/api\/studio\/playback(?:\/|$)/.test(path)) return true
      const decoded = decodeURIComponent(path)
      if (decoded === path) return false
      path = new URL(decoded, "https://relative.invalid").pathname
    }
    return /^\/api\/studio\/playback(?:\/|$)/.test(path)
  } catch {
    return false
  }
}
export function studioPosterFromHls(value: string | null | undefined) {
  if (!isStudioPlaybackUrl(value)) return undefined
  const url = new URL(value, "https://relative.invalid")
  if (!url.pathname.endsWith("/index.m3u8")) return undefined
  url.pathname = url.pathname.replace(/index\.m3u8$/, "poster.webp")
  return value.startsWith("/") ? url.pathname : url.href
}
