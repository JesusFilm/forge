// SYNC: TV port of apps/mobile/src/lib/watchSeed.ts. Same sanitizing decode —
// only the import paths differ (muxUrl + resolveImageUrl + validateUrl are
// TV-local copies).
//
// Seed data carried from a list surface (search result, Up Next card) into the
// /watch/[slug] route so the screen can paint instantly from data already in
// hand, before any network fetch resolves.
//
// Values are UNTRUSTED on the receiving side: deep links are externally
// addressable, so a crafted link could supply anything. `decodeWatchSeed`
// sanitizes every URL-bearing field and drops anything that doesn't validate —
// the worst case degrades to "no seed" (skeleton), never an unsafe URL reaching
// the player or image loader.

import { muxHlsUrlFromPlaybackId } from "./muxUrl"
import { resolveImageUrl } from "./resolveImageUrl"
import { validateStreamingUrl } from "./validateUrl"

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
 * Decode and sanitize the `seed` param. Returns a validated seed, or null when
 * the param is absent, malformed, or missing a usable slug.
 *
 * Decode-once: this app's router does not pre-decode query params, so the value
 * arrives still-encoded.
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
