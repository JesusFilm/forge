import { Platform } from "react-native"

/**
 * In dev, relative paths resolve to the local Next.js server which serves
 * apps/web/public/ directly. In production, the web app sits behind Cloudflare
 * routing that intercepts static file paths, so we resolve to the GitHub raw
 * URL for the same files in apps/web/public/.
 */
const STATIC_BASE_URL = __DEV__
  ? Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch"
  : "https://raw.githubusercontent.com/JesusFilm/forge/main/apps/web/public"

/**
 * Resolve and validate an image URL from CMS content.
 *
 * - **Relative paths** (e.g. /images/thumbnails/...): Prefixed with the
 *   appropriate static base URL for the current environment.
 * - **Absolute URLs**: Must use https (or http in dev). Passed through as-is.
 * - **Invalid/dangerous schemes**: Returns null.
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null

  // Relative paths — static assets from apps/web/public/
  if (url.startsWith("/") && !url.startsWith("//")) {
    return `${STATIC_BASE_URL}${url}`
  }

  try {
    const parsed = new URL(url)

    if (parsed.protocol === "http:" && !__DEV__) {
      return null
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null
    }

    return url
  } catch {
    return null
  }
}
