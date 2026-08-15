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
  claimPlayback,
  createClaimToken,
  getHostPlayer,
  getPlaybackClaim,
  isPlaybackClaimant,
  releasePlaybackClaim,
  subscribeToHostPlayer,
  subscribeToPlaybackClaim,
  type ClaimToken,
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

/**
 * How many times one route may put its claim back after the host revoked it.
 *
 * One. A host crash is usually deterministic, so this buys the transient case
 * a recovery and costs the deterministic case one extra failed mount. Zero
 * strands the screen with no player; unbounded locks the app in a
 * mount-throw-revoke loop.
 */
const MAX_CLAIM_REASSERTS = 1

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

  // WHICH session is live, never the session itself: the store rewrites its
  // snapshot every second with the position, and subscribing this screen to
  // that object re-renders the whole watch route at the same cadence.
  const liveSessionKey = useSyncExternalStore(store.subscribe, () => {
    const live = store.getSnapshot()
    return live == null ? null : sessionIdentityKey(live)
  })

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

  // One token for this route instance's whole life. Lazy: the argument to
  // useRef is evaluated on every render and thrown away.
  const tokenRef = useRef<ClaimToken | null>(null)
  if (tokenRef.current == null) tokenRef.current = createClaimToken()
  const token = tokenRef.current

  useEffect(() => {
    if (claim == null) {
      releasePlaybackClaim(token)
      return
    }
    // R12/AE3: opening a different video replaces what the window is playing.
    // Ended HERE, before the claim re-points the host, so the departing
    // session closes while its own player is still mounted to flush it.
    const live = store.getSnapshot()
    if (live != null && !isSameSession(live, claim)) store.end("replaced")
    claimPlayback(token, claim)
  }, [claim, store, token])

  // Unmount only. Releasing the claim on every change would drop the host to
  // its session for a commit, which is a surface handoff nothing asked for.
  useEffect(() => () => releasePlaybackClaim(token), [token])

  // The host's error boundary revokes every claim when its subtree throws, and
  // nothing else would put this route's claim back: `claim` is unchanged by
  // that, so the effect above can never re-run.
  const liveClaim = useSyncExternalStore(
    subscribeToPlaybackClaim,
    getPlaybackClaim,
  )
  const reassertsRef = useRef({ key: claimKey, left: MAX_CLAIM_REASSERTS })
  useEffect(() => {
    if (claim == null) return
    // Registered but not in front means another watch route is on top. It owns
    // the player, this one gets it back when that route pops, and re-asserting
    // here would steal the surface out from under the foreground screen.
    if (isPlaybackClaimant(token)) return
    // Bounded, not idempotent: the throw that revoked the claim is usually
    // deterministic, so an unbounded re-assert is a mount-throw-revoke loop.
    // A different video is a fresh problem, so it gets a fresh budget.
    const budget = reassertsRef.current
    const left = budget.key === claimKey ? budget.left : MAX_CLAIM_REASSERTS
    if (left <= 0) return
    reassertsRef.current = { key: claimKey, left: left - 1 }
    claimPlayback(token, claim)
  }, [claim, claimKey, liveClaim, token])

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

  // A latch that is never cleared admits ONE session per route instance, so a
  // dismissal or a playToEnd left this screen unable to publish ever again. The
  // re-arm needs a fresh onPlayingChange, which is why it does not resurrect.
  useEffect(() => {
    if (startedKey == null) return
    // Read the store LIVE. The publish effect above runs in this same commit,
    // so the rendered snapshot is still the pre-publish one and would clear the
    // latch that publish just used.
    if (isSameSession(store.getSnapshot(), claim)) return
    setStartedKey(null)
  }, [claim, liveSessionKey, startedKey, store])

  const entry = useSyncExternalStore(subscribeToHostPlayer, getHostPlayer)
  return { player: borrowedPlayer(entry, claim), onPlayingChange }
}
