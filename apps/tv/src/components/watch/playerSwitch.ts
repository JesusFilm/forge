// Pure, React-free decision logic for the fullscreen overlay player's live
// dub-switch + in-player menu gating (U7). Extracted into a `.ts` file so the
// bug-prone source-swap and stale-session gating decisions are unit-testable
// without rendering: jest-expo can't load `.tsx` (the @types/react csstype
// import trips the transform), so the testable logic lives here and
// VideoPlayer.tsx is a thin React shell that calls these.
//
// CHARACTERIZATION — the no-session contract (NON-NEGOTIABLE INVARIANT):
// Experience-card playback calls VideoPlayerContext.playVideo(url) with NO
// watch session populated (video == null). In that path:
//   - inPlayerMenuVisible(...) MUST return false (no in-player menu mounts),
//   - the overlay's "current desired source" is the streamingUrl PROP (the
//     session's activeVariant is irrelevant — there is no session video),
//   - no subtitle layer / dub-switch logic engages.
// Every new behavior is gated on inPlayerMenuVisible(...) being true, which can
// only happen when a session video with variants exists AND the currently
// playing URL IS that session's active dub. This file is where that gate lives.

import { extractMuxPlaybackId } from "../../lib/muxUrl"
import { validateStreamingUrl } from "../../lib/validateUrl"

/**
 * Decide whether a source swap should reload the player.
 *
 *   - "noop"    → the next URL points at the same Mux asset already loaded
 *                 (same playback id) → do NOT reset/rebuffer. Only the
 *                 subtitle slug may have changed; the player keeps playing.
 *   - "replace" → a different asset (or one whose id can't be matched) → call
 *                 player.replaceAsync(nextUrl).
 *
 * Decided by Mux playback id, not raw URL string: an optimistic seed URL is
 * rebuilt from a playbackId while the resolved variant carries the stored
 * `hls`, so the same asset can have two different URL strings — comparing
 * strings would needlessly restart playback.
 *
 * `nextUrl` must pass validateStreamingUrl (Mux host allowlist) — a tainted /
 * non-Mux next source is rejected as "noop" so it never reaches the player.
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
 * The stale-session-safe gate for every session-driven overlay behavior
 * (in-player menu, live dub-switch, subtitle layer).
 *
 * Returns true ONLY when:
 *   1. a session video is present (`sessionVideo` non-null), AND
 *   2. it has at least one variant (a dub list to switch between), AND
 *   3. the currently-playing asset IS the session's active dub — i.e.
 *      `currentUrl` matches `activeVariantHls` by Mux playback id.
 *
 * Condition (3) is what makes this stale-safe: a session left over from a
 * prior details-screen visit must NOT attach a menu (or apply its prior
 * dub/subtitle selections) to an experience-card play of an unrelated URL.
 * Matching by playback id (not exact string) tolerates the seed-URL vs
 * stored-`hls` shape difference for the same asset.
 *
 * With no session (`sessionVideo == null`) this is false — the proof that
 * experience-card playback is unchanged.
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
