import { Platform } from "react-native"
import { env } from "../env"

/**
 * Resolve an image URL that may be a relative path from the web app.
 * Relative paths like /images/thumbnails/... are static assets served from
 * the Next.js web app's public/ directory under its basePath (/watch).
 * Production CMS content uses absolute CDN URLs; relative paths only appear
 * in local dev seed data, so we prepend the local web app origin.
 */
export const WEB_BASE_URL =
  env.EXPO_PUBLIC_WEB_BASE_URL ??
  (__DEV__
    ? Platform.OS === "android"
      ? "http://10.0.2.2:3000/watch"
      : "http://localhost:3000/watch"
    : "https://www.jesusfilm.org/watch")

/**
 * Trusted image hosts. Absolute URLs from CMS data are only loaded if they
 * match one of these domains. Unknown origins are rejected (returns null),
 * which degrades gracefully to the dark card background.
 */
const ALLOWED_IMAGE_HOSTS = [
  "jesusfilm.org",
  "arclight.org",
  "cloudfront.net",
  "amazonaws.com",
]

function isAllowedImageHost(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return ALLOWED_IMAGE_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    )
  } catch {
    return false
  }
}

export function resolveImageUrl(url: string | null | undefined): string | null {
  if (url == null) return null
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return isAllowedImageHost(url) ? url : null
  }
  if (url.startsWith("/")) return `${WEB_BASE_URL}${url}`
  return null
}
