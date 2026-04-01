const ALLOWED_IMAGE_HOSTS = new Set([
  "jesusfilm.org",
  "www.jesusfilm.org",
  "arclight.org",
  "cloudfront.net",
  "amazonaws.com",
  "imagedelivery.net",
  "stream.mux.com",
  "image.mux.com",
  "images.unsplash.com",
])

function isAllowedHost(hostname: string): boolean {
  if (ALLOWED_IMAGE_HOSTS.has(hostname)) return true
  // Check if hostname ends with an allowed domain (e.g., d1234.cloudfront.net)
  for (const host of ALLOWED_IMAGE_HOSTS) {
    if (hostname.endsWith(`.${host}`)) return true
  }
  return false
}

/**
 * Resolve and validate an image URL from CMS content.
 * Returns null for invalid or disallowed URLs.
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null

  try {
    // Relative URLs — prefix with CDN base (for local dev images like /images/thumbnails/...)
    if (url.startsWith("/")) {
      return url // Let the bundler or dev server handle relative paths
    }

    const parsed = new URL(url)

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null
    }

    if (!isAllowedHost(parsed.hostname)) {
      if (__DEV__) {
        console.warn(`[resolveImageUrl] Blocked host: ${parsed.hostname}`)
      }
      return null
    }

    return url
  } catch {
    return null
  }
}
