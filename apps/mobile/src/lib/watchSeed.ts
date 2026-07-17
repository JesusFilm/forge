import { muxHlsUrlFromPlaybackId } from "./muxThumbnail"
import { resolveImageUrl } from "./resolveImageUrl"
import { validateStreamingUrl } from "./validateUrl"

/**
 * Seed carried from a list surface into the video detail route so it paints
 * instantly before any fetch. Encoded as one URL-safe `seed` param; untrusted
 * (deep links), so `decodeWatchSeed` validates every URL field and drops bad ones.
 */
export type WatchSeed = {
  slug: string
  title: string | null
  imageUrl: string | null
  playbackId: string | null
}

/** Encode a seed for use as the `seed` query param value on the watch route. */
export function encodeWatchSeed(seed: WatchSeed): string {
  return encodeURIComponent(JSON.stringify(seed))
}

/**
 * Decode and sanitize the `seed` param; null if absent, malformed, or no slug.
 * Decode-once mirrors `parseSectionKey` — this router doesn't pre-decode query
 * params, so the value arrives still-encoded.
 */
export function decodeWatchSeed(
  raw: string | string[] | undefined | null,
): WatchSeed | null {
  if (raw == null) return null
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(value))
  } catch {
    // Malformed percent-encoding or non-JSON payload.
    return null
  }

  if (typeof parsed !== "object" || parsed === null) return null
  const obj = parsed as Record<string, unknown>

  const slug = typeof obj.slug === "string" && obj.slug ? obj.slug : null
  if (!slug) return null

  const title = typeof obj.title === "string" ? obj.title : null

  // Image: keep only if it resolves to a safe (https / static) URL.
  const rawImage = typeof obj.imageUrl === "string" ? obj.imageUrl : null
  const imageUrl = rawImage ? resolveImageUrl(rawImage) : null

  // Playback ID: keep only if it produces a valid Mux stream URL. The builder
  // already rejects non-alphanumeric tokens; validateStreamingUrl is a second
  // gate confirming the host is the Mux streaming domain.
  const rawPlaybackId =
    typeof obj.playbackId === "string" ? obj.playbackId : null
  const playbackId =
    rawPlaybackId &&
    validateStreamingUrl(muxHlsUrlFromPlaybackId(rawPlaybackId))
      ? rawPlaybackId
      : null

  return { slug, title, imageUrl, playbackId }
}
