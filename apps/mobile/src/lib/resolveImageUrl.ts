import { Platform } from "react-native"

/**
 * Static asset base. Dev hits the local Next.js server; prod can't (Cloudflare
 * intercepts static paths), so it resolves to GitHub raw for apps/web/public/.
 */
const STATIC_BASE_URL = __DEV__
  ? Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch"
  : "https://raw.githubusercontent.com/JesusFilm/forge/main/apps/web/public"

/**
 * Resolve and validate a CMS image URL. Relative paths get the static base
 * prefix; absolute URLs must be https (or http in dev); else null.
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
