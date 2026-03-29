import { Platform } from "react-native"

/**
 * Resolve an image URL that may be a relative path from the web app.
 * Relative paths like /images/thumbnails/... are static assets served from
 * the Next.js web app's public/ directory under its basePath (/watch).
 * Production CMS content uses absolute CDN URLs; relative paths only appear
 * in local dev seed data, so we prepend the local web app origin.
 */
export const WEB_BASE_URL =
  process.env.EXPO_PUBLIC_WEB_BASE_URL ??
  (Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch")

export function resolveImageUrl(url: string | null | undefined): string | null {
  if (url == null) return null
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  if (url.startsWith("/")) return `${WEB_BASE_URL}${url}`
  return null
}
