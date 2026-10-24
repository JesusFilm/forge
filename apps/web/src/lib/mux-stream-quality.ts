/**
 * Apply a Mux playback modifier to an HLS manifest URL.
 *
 * This has to be a URL rewrite rather than a `<MuxVideo maxResolution=...>`
 * prop. `@mux/playback-core`'s URL builder opens with an early return when
 * `playbackId` is absent, and the surfaces that use this helper pass only
 * `src` — so every resolution prop is silently dropped. The TypeScript
 * `MaxResolution` union also starts at `"720p"` and cannot express 480p at
 * all. The URL can, and it is the only lever that survives native HLS
 * playback (iOS Safari), where `Hls.isSupported()` is false and no hls.js
 * config applies.
 *
 * `apps/mobile/src/lib/streamQuality.ts` (`applyQualityConstraint`) is the
 * sibling copy of this idiom. The two are deliberately not shared: the apps
 * share no lib today, and feat-440 records that apps/mobile keeps its own
 * independent copy of the carousel sequence for the same reason. They also
 * differ on purpose — the mobile helper accepts `http:` and `https:`, while
 * this one rewrites `https:` only, because Admin is the sole producer of the
 * URLs it sees.
 */

/** The one Mux streaming host this helper will touch. */
export const MUX_STREAM_HOST = "stream.mux.com"

/**
 * The rungs a caller may request. Narrow rather than `string` so a typo is a
 * compile error instead of a silently ignored query parameter.
 */
export type MuxMaxResolution = "480p" | "720p" | "1080p"

const RESOLUTION_MODIFIERS = ["max_resolution", "min_resolution"] as const

/**
 * Pure. Reads nothing ambient — no `window`, no `navigator`, no
 * `devicePixelRatio` — so a re-render can never produce a different string for
 * the same input and swap `src` on a mounted media element.
 */
export function applyMuxMaxResolution(
  url: string,
  maxResolution: MuxMaxResolution,
): string {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  if (parsed.protocol !== "https:") return url
  if (parsed.hostname !== MUX_STREAM_HOST) return url
  // A signed Mux URL carries its constraints inside the JWT. Appending one to
  // the query string is ignored or rejected server-side, so leave it alone.
  if (parsed.searchParams.has("token")) return url

  // Replace, never stack: an inherited `min_resolution` would fight the cap.
  for (const modifier of RESOLUTION_MODIFIERS) {
    parsed.searchParams.delete(modifier)
  }
  parsed.searchParams.set("max_resolution", maxResolution)

  return parsed.toString()
}
