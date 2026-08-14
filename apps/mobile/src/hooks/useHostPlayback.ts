/**
 * The watch route's half of the one-player rule (U6, part 4).
 *
 * It claims the root host's player instead of creating one, and it publishes
 * the mini player session once — and only once — playback has actually
 * started. The route stays free of the store's verbs, and every rule below is
 * reachable from a test without expo-router.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { getMiniPlayerStore } from "../lib/miniPlayer"
import {
  borrowedPlayer,
  getHostPlayer,
  setPlaybackClaim,
  subscribeToHostPlayer,
  type HostPlayerEntry,
  type PlaybackClaim,
} from "../lib/miniPlayer/hostPlayer"
import {
  admitsSession,
  isSameSession,
  normalizeSessionIdentity,
  sessionActionFor,
  sessionIdentityKey,
} from "../lib/miniPlayer/session"
import type {
  MiniPlayerSessionInput,
  MiniPlayerStore,
} from "../lib/miniPlayer/store"

export type HostPlaybackOptions = {
  /**
   * The video this screen wants to play, or null while it has no source.
   * Memoize it: it drives the claim, and a fresh object per render would
   * re-run the claim at the progress store's write-back cadence.
   */
  claim: PlaybackClaim | null
  posterUrl?: string | null
  title?: string | null
  store?: MiniPlayerStore
}

export type HostPlayback = {
  /**
   * The host's player for this screen, or null while it must not mount a
   * video view. Null covers three states the caller treats alike: no source
   * yet, the host has not built the player yet, and the host's own window has
   * not released the surface.
   */
  player: HostPlayerEntry | null
  /** Wire straight to the surface's `onPlayingChange`. Referentially stable. */
  onPlayingChange: (isPlaying: boolean) => void
}

export function useHostPlayback({
  claim,
  posterUrl,
  title,
  store = getMiniPlayerStore(),
}: HostPlaybackOptions): HostPlayback {
  const claimKey = claim == null ? null : sessionIdentityKey(claim)

  // Admission (AE10). A one-way latch on the FIRST true, keyed by video so a
  // re-point inside this screen cannot inherit the previous video's latch.
  const [startedKey, setStartedKey] = useState<string | null>(null)
  const claimKeyRef = useRef(claimKey)
  claimKeyRef.current = claimKey
  const onPlayingChange = useCallback((isPlaying: boolean) => {
    // Reading the instantaneous playing state instead would be wrong the other
    // way: it is false after any pause, which is the commonest way anyone
    // reaches a mini player.
    if (isPlaying) setStartedKey(claimKeyRef.current)
  }, [])
  const hasPlaybackStarted = startedKey != null && startedKey === claimKey

  useEffect(() => {
    if (claim == null) {
      setPlaybackClaim(null)
      return
    }
    // R12/AE3: opening a different video replaces what the window is playing.
    // Ended HERE, before the claim re-points the host, so the departing
    // session closes while its own player is still mounted to flush it.
    const live = store.getSnapshot()
    if (live != null && !isSameSession(live, claim)) store.end("replaced")
    setPlaybackClaim(claim)
  }, [claim, store])

  // Unmount only. Releasing the claim on every change would drop the host to
  // its session for a commit, which is a surface handoff nothing asked for.
  useEffect(() => () => setPlaybackClaim(null), [])

  useEffect(() => {
    if (claim == null) return
    const identity = normalizeSessionIdentity(claim)
    if (identity == null) return
    const live = store.getSnapshot()
    // Two doors, and the second is not a shortcut: expanding the window mounts
    // this screen over a session that was ALREADY admitted, and a paused
    // player emits no playingChange for the latch to catch.
    if (!admitsSession(hasPlaybackStarted) && !isSameSession(live, claim))
      return
    const action = sessionActionFor(live, identity)
    if (action === "none") return
    const input: MiniPlayerSessionInput = {
      ...identity,
      streamingUrl: claim.streamingUrl,
      posterUrl,
      title,
    }
    // `update`, not `start`, for a source that merely re-pointed: the manifest
    // hydrating a file:// copy and a seed URL resolving to the canonical one
    // are both the same session, and `start` files a `replaced` for neither.
    if (action === "start") store.start(input)
    else store.update(input)
  }, [claim, hasPlaybackStarted, posterUrl, title, store])

  const entry = useSyncExternalStore(subscribeToHostPlayer, getHostPlayer)
  return { player: borrowedPlayer(entry, claim), onPlayingChange }
}
