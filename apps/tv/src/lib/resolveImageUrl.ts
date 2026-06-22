// SYNC: keep in sync with apps/mobile/src/lib/resolveImageUrl.ts
// (getMuxThumbnailUrl is TV-only — not in mobile)

import { Platform } from "react-native"

/**
 * Dev: relative paths hit the local Next.js server serving apps/web/public/.
 * Prod: Cloudflare intercepts static paths, so resolve to the GitHub raw URL
 * for the same apps/web/public/ files.
 */
const STATIC_BASE_URL = __DEV__
  ? Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch"
  : "https://raw.githubusercontent.com/JesusFilm/forge/main/apps/web/public"

/**
 * Resolve and validate a CMS image URL. Relative paths get the env static base
 * prefix; absolute URLs must be https (or http in dev) and pass through as-is;
 * invalid/dangerous schemes return null.
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

/**
 * Derive a thumbnail URL from a Mux HLS stream (`stream.mux.com/{ID}.m3u8` →
 * `image.mux.com/{ID}/thumbnail.jpg`). Returns null for non-Mux URLs.
 */
export function getMuxThumbnailUrl(
  streamingUrl: string | null | undefined,
): string | null {
  if (!streamingUrl) return null
  try {
    const parsed = new URL(streamingUrl)
    if (parsed.hostname !== "stream.mux.com") return null
    const playbackId = parsed.pathname.replace(/^\//, "").replace(/\.m3u8$/, "")
    if (!playbackId || !/^[a-zA-Z0-9_-]+$/.test(playbackId)) return null
    return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=1920&height=1080&fit_mode=smartcrop`
  } catch {
    return null
  }
}
