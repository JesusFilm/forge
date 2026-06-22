// Pure, React-free decision logic for the overlay player's live dub-switch +
// in-player menu gating (U7). Extracted to .ts so the source-swap/stale-session
// decisions are unit-testable (jest-expo can't load .tsx); VideoPlayer.tsx is a
// thin shell over these.
//
// NON-NEGOTIABLE INVARIANT — the no-session contract: experience-card playback
// calls playVideo(url) with no watch session (video == null). In that path
// inPlayerMenuVisible MUST be false, the desired source is the streamingUrl PROP
// (no session activeVariant), and no subtitle/dub-switch logic engages. Every
// new behavior is gated on inPlayerMenuVisible — true only when a session video
// with variants exists AND the playing URL IS that session's active dub.

import { extractMuxPlaybackId } from "../../lib/muxUrl"
import { validateStreamingUrl } from "../../lib/validateUrl"

/**
 * Decide whether a source swap should reload the player: "noop" = same Mux
 * asset already loaded (keep playing), "replace" = different/unmatchable asset
 * (call replaceAsync). Compared by Mux playback id, not URL string, since the
 * same asset can have two URL strings (seed URL vs stored `hls`). `nextUrl`
 * must pass validateStreamingUrl — a tainted/non-Mux source returns "noop".
 */
export function shouldReplaceSource(
  currentLoadedUrl: string | null | undefined,
  nextUrl: string | null | undefined,
): "noop" | "replace" {
  // An unvalidated / non-Mux next source must never reach the player.
  if (!validateStreamingUrl(nextUrl)) return "noop"

  const currentId = extractMuxPlaybackId(currentLoadedUrl)
  const nextId = extractMuxPlaybackId(nextUrl)

  // Same Mux asset already loaded → no reload (avoids the rebuffer flash).
  if (currentId != null && nextId != null && currentId === nextId) return "noop"

  // Different asset, or an id we can't match on either side → reload.
  return "replace"
}

/**
 * Stale-session-safe gate for every session-driven overlay behavior (menu, live
 * dub-switch, subtitle layer). True ONLY when (1) sessionVideo is non-null, (2)
 * it has ≥1 variant, AND (3) currentUrl matches activeVariantHls by Mux playback
 * id. (3) is the stale-safety: a leftover session must NOT attach to an
 * experience-card play of an unrelated URL. No session → false.
 */
export function inPlayerMenuVisible({
  sessionVideo,
  activeVariantHls,
  currentUrl,
}: {
  sessionVideo: { variants: readonly unknown[] } | null | undefined
  activeVariantHls: string | null | undefined
  currentUrl: string | null | undefined
}): boolean {
  // (1) no session video → no menu (experience-card playback path).
  if (sessionVideo == null) return false
  // (2) a video with no dubs has nothing to switch between.
  if (sessionVideo.variants.length === 0) return false
  // (3) the active dub must actually be what's playing right now.
  if (!currentUrl || !activeVariantHls) return false
  const playingId = extractMuxPlaybackId(currentUrl)
  const activeId = extractMuxPlaybackId(activeVariantHls)
  if (playingId == null || activeId == null) return false
  return playingId === activeId
}
