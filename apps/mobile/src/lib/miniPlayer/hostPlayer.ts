// The seam between the watch route and the root-owned player (U6, part 4).
//
// Module scope, not React context: `PlaybackHost` mounts as a SIBLING of the
// Stack (KTD1), so it cannot provide a context any route can read. Both
// channels carry stable handles only — never the one-second position, which
// would re-render every screen under the root on each tick (KTD2).

import type { VideoPlayer } from "expo-video"

import {
  isSameSession,
  sessionIdentityKey,
  type SessionIdentity,
} from "./session"

/**
 * A foreground route asking the host to own the player for this video.
 *
 * The claim is NOT a session: it dies with the route unless playback started
 * and the route published one. It exists so the route never creates a second
 * player of its own — the thing that made one video decode twice.
 */
export type PlaybackClaim = SessionIdentity & { streamingUrl: string }

/** The host's live player, handed back to whoever claimed it. */
export type HostPlayerEntry = {
  player: VideoPlayer
  /** `sessionIdentityKey` of the video this player is loaded with. */
  identityKey: string
  isPlaying: boolean
  /**
   * The host's own window holds NO video surface right now, so the claimant
   * may mount one. Android asserts on two views owning one player, so the
   * handoff is sequential in both directions rather than a cross-fade.
   */
  surfaceFree: boolean
}

function sameClaim(a: PlaybackClaim | null, b: PlaybackClaim | null): boolean {
  if (a == null || b == null) return a === b
  return (
    a.streamingUrl === b.streamingUrl &&
    a.videoId === b.videoId &&
    a.videoSlug === b.videoSlug &&
    (a.languageSlug ?? null) === (b.languageSlug ?? null)
  )
}

function sameEntry(
  a: HostPlayerEntry | null,
  b: HostPlayerEntry | null,
): boolean {
  if (a == null || b == null) return a === b
  return (
    a.player === b.player &&
    a.identityKey === b.identityKey &&
    a.isPlaying === b.isPlaying &&
    a.surfaceFree === b.surfaceFree
  )
}

let claim: PlaybackClaim | null = null
const claimListeners = new Set<() => void>()

let entry: HostPlayerEntry | null = null
const entryListeners = new Set<() => void>()

function notify(listeners: Set<() => void>) {
  for (const listener of [...listeners]) listener()
}

/** Stable while nothing changed: `useSyncExternalStore` compares by identity,
 *  so a fresh object per write is a render loop, not a performance note. */
export function setPlaybackClaim(next: PlaybackClaim | null): void {
  if (sameClaim(claim, next)) return
  claim = next
  notify(claimListeners)
}

export function getPlaybackClaim(): PlaybackClaim | null {
  return claim
}

export function subscribeToPlaybackClaim(listener: () => void): () => void {
  claimListeners.add(listener)
  return () => {
    claimListeners.delete(listener)
  }
}

export function setHostPlayer(next: HostPlayerEntry | null): void {
  if (sameEntry(entry, next)) return
  entry = next
  notify(entryListeners)
}

export function getHostPlayer(): HostPlayerEntry | null {
  return entry
}

export function subscribeToHostPlayer(listener: () => void): () => void {
  entryListeners.add(listener)
  return () => {
    entryListeners.delete(listener)
  }
}

/**
 * The host's player for THIS claim, or null.
 *
 * Matched on the identity key rather than on presence: while the viewer opens
 * a second video the host is still holding the first one's player, and
 * attaching the new route's surface to it would show the previous video.
 *
 * A player whose surface the host's own window still holds also reads as null.
 * The claimant must wait for that surface to go, not race it.
 */
export function borrowedPlayer(
  entryNow: HostPlayerEntry | null,
  claimed: SessionIdentity | null,
): HostPlayerEntry | null {
  if (claimed == null || entryNow == null || !entryNow.surfaceFree) return null
  return entryNow.identityKey === sessionIdentityKey(claimed) ? entryNow : null
}

export type ActivePlayback = {
  streamingUrl: string
  videoId?: string
  videoSlug?: string
  languageSlug: string | null
}

/**
 * Which video the host owns a player for.
 *
 * The route's claim wins the SOURCE, because the route is what the viewer is
 * looking at. A live session for the same video fills in identity the claim
 * has not resolved yet, so a route whose record arrives late cannot strip the
 * videoId the progress recorder is already writing under.
 */
export function resolveActivePlayback(
  claim: PlaybackClaim | null,
  session: (SessionIdentity & { streamingUrl: string }) | null,
): ActivePlayback | null {
  if (claim == null) {
    if (session == null) return null
    return {
      streamingUrl: session.streamingUrl,
      videoId: session.videoId,
      videoSlug: session.videoSlug,
      languageSlug: session.languageSlug ?? null,
    }
  }
  // Only a session for the SAME video may donate fields. Carrying them from a
  // different one stamps the departing video's id onto the arriving one.
  const carried = isSameSession(session, claim) ? session : null
  return {
    streamingUrl: claim.streamingUrl,
    videoId: claim.videoId ?? carried?.videoId,
    videoSlug: claim.videoSlug ?? carried?.videoSlug,
    languageSlug: claim.languageSlug ?? carried?.languageSlug ?? null,
  }
}

/** Test and teardown only. */
export function resetHostPlayerBridge(): void {
  claim = null
  entry = null
  claimListeners.clear()
  entryListeners.clear()
}
