import { Platform } from "react-native"

/**
 * Base URL for the Next.js web app that serves static images from public/.
 * Relative paths in CMS data (e.g. /images/thumbnails/...) are assets in
 * apps/web/public/ served under the /watch basePath.
 */
const WEB_BASE_URL = __DEV__
  ? Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch"
  : "https://www.jesusfilm.org/watch"

const ALLOWED_IMAGE_HOSTS = new Set([
  "jesusfilm.org",
  "www.jesusfilm.org",
  "arclight.org",
  "imagedelivery.net",
  "stream.mux.com",
  "image.mux.com",
  "images.unsplash.com",
])

function isAllowedHost(hostname: string): boolean {
  if (ALLOWED_IMAGE_HOSTS.has(hostname)) return true
  for (const host of ALLOWED_IMAGE_HOSTS) {
    if (hostname.endsWith(`.${host}`)) return true
  }
  return false
}

/**
 * Resolve and validate an image URL from CMS content.
 * Relative paths (e.g. /images/thumbnails/...) are prefixed with the web app
 * base URL. Absolute URLs are validated against the allowed hosts list.
 * Returns null for invalid or disallowed URLs.
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null

  // Relative paths — static assets served by the Next.js web app
  if (url.startsWith("/") && !url.startsWith("//")) {
    return `${WEB_BASE_URL}${url}`
  }

  try {
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
