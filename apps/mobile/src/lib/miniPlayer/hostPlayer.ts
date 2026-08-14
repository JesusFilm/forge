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

/**
 * One claimant's identity. A route instance mints exactly one and holds it for
 * its whole life.
 *
 * A native stack keeps `/watch/A` mounted under `/watch/B`, so the claim is not
 * one anonymous slot: without a token, B's unmount clears A's claim and A is
 * left with no player at all.
 */
export type ClaimToken = { readonly id: number }

let nextClaimTokenId = 1

export function createClaimToken(): ClaimToken {
  return { id: nextClaimTokenId++ }
}

/** The host's live player, handed back to whoever claimed it. */
export type HostPlayerEntry = {
  player: VideoPlayer
  /** `sessionIdentityKey` of the video this player is loaded with. */
  identityKey: string
  isPlaying: boolean
  /**
   * The commit in which the host's window mounted NO video view has landed, so
   * the claimant may mount one.
   *
   * An ORDERING signal, not an independent one. It reads `windowHoldsSurface`,
   * the predicate the window itself renders on, and the host publishes it from
   * an effect — one commit behind the claim that caused it. That lag IS the
   * guarantee: Android asserts on two views owning one player, and a route that
   * borrows on the claim it just made lands its view in the window's last
   * commit.
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

type ClaimRegistration = { token: ClaimToken; claim: PlaybackClaim }

/** Registration order, oldest first. The LAST one owns the player: a native
 *  stack mounts the newest screen on top, and that is the foreground. */
let registrations: ClaimRegistration[] = []

let claim: PlaybackClaim | null = null
const claimListeners = new Set<() => void>()

let entry: HostPlayerEntry | null = null
const entryListeners = new Set<() => void>()

function notify(listeners: Set<() => void>) {
  for (const listener of [...listeners]) listener()
}

/** Stable while nothing changed: `useSyncExternalStore` compares by identity,
 *  so a fresh object per write is a render loop, not a performance note. */
function publishClaim(): void {
  const next = registrations.at(-1)?.claim ?? null
  if (sameClaim(claim, next)) return
  claim = next
  notify(claimListeners)
}

/**
 * This claimant wants the host's player for `next`.
 *
 * A token already in the registry keeps its PLACE. A source that hydrates late
 * — the downloads manifest swapping in a `file://` copy — must not promote a
 * background route over the screen the viewer is looking at.
 */
export function claimPlayback(token: ClaimToken, next: PlaybackClaim): void {
  registrations = registrations.some(
    (registration) => registration.token === token,
  )
    ? registrations.map((registration) =>
        registration.token === token ? { token, claim: next } : registration,
      )
    : [...registrations, { token, claim: next }]
  publishClaim()
}

/** This claimant is done. The claimant below it takes the player back with no
 *  re-assertion of its own. */
export function releasePlaybackClaim(token: ClaimToken): void {
  const next = registrations.filter(
    (registration) => registration.token !== token,
  )
  if (next.length === registrations.length) return
  registrations = next
  publishClaim()
}

/**
 * The host drops EVERY claim.
 *
 * Only the host's error boundary calls this: its subtree threw, so the player
 * behind every registration is gone. Claimants re-assert on their own budget —
 * see `useHostPlayback` — which is what stops a deterministic throw looping.
 */
export function revokePlaybackClaims(): void {
  if (registrations.length === 0) return
  registrations = []
  publishClaim()
}

/** Is this claimant still in the registry? False after a revoke, and the
 *  question a claimant asks before it re-asserts. */
export function isPlaybackClaimant(token: ClaimToken): boolean {
  return registrations.some((registration) => registration.token === token)
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
 * An entry published from a commit in which the window still mounted its view
 * also reads as null — see `surfaceFree`. The claimant waits for the host to
 * publish the release rather than acting on the claim it just made.
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
  registrations = []
  claim = null
  entry = null
  claimListeners.clear()
  entryListeners.clear()
}
