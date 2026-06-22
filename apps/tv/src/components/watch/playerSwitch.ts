// Pure, React-free logic for the overlay player's dub-switch + in-player menu
// gating (U7), in .ts so source-swap/stale-session decisions stay testable.
// INVARIANT (no-session contract): experience-card playVideo() has no session, so inPlayerMenuVisible MUST be false and no dub-switch engages.

import { extractMuxPlaybackId } from "../../lib/muxUrl"
import { validateStreamingUrl } from "../../lib/validateUrl"

/**
 * Decide whether a source swap reloads the player: "noop" = same Mux asset, else
 * "replace". Compared by Mux playback id (one asset can have two URLs: seed vs
 * stored `hls`); `nextUrl` must pass validateStreamingUrl or returns "noop".
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
 * Stale-session-safe gate for session-driven overlay behavior (menu, dub-switch,
 * subtitle). True ONLY when (1) sessionVideo non-null, (2) ≥1 variant, (3) currentUrl
 * matches activeVariantHls by Mux id — (3) stops a leftover session attaching to an unrelated card play. No session → false.
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
