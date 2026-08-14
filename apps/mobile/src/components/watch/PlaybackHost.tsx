/**
 * The root-owned playback host (U6/KTD2).
 *
 * It owns the ONE expo-video player for whatever the mini player store says is
 * playing OR the watch route has claimed, so the player outlives that route.
 * Exactly one VideoView is mounted for it at all times, visible or suppressed
 * — this host's own (see MiniPlayerWindowSlot) unless the watch route holds
 * the claim, in which case that route renders the only surface.
 *
 * Everything testable lives here or in the pure modules under
 * `src/lib/miniPlayer/` — expo-router cannot be imported unmounted under this
 * repo's jest setup, so the router read is an injected hook with a lazy
 * `require` default and `app/_layout.tsx` stays pure wiring.
 */

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react"
import { BackHandler, Platform, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { ErrorInfo, ReactNode } from "react"
import type { VideoPlayer } from "expo-video"

import {
  MiniPlayerWindow,
  type MiniPlayerWindowProps,
  type MiniPlayerWindowVideo,
} from "./MiniPlayerWindow"
import { useManagedVideoPlayer } from "../../hooks/useManagedVideoPlayer"
import { reportDatadogError } from "../../lib/datadog"
import {
  getMiniPlayerSheets,
  getMiniPlayerStore,
  registerSessionEnd,
} from "../../lib/miniPlayer"
import type { SessionEndListener } from "../../lib/miniPlayer/endRegistry"
import {
  getPlaybackClaim,
  resolveActivePlayback,
  setHostPlayer,
  setPlaybackClaim,
  subscribeToPlaybackClaim,
} from "../../lib/miniPlayer/hostPlayer"
import {
  isPictureInPictureActive,
  subscribeToPictureInPicture,
} from "../../lib/miniPlayer/pipLatch"
import {
  presentationFor,
  type MiniPlayerPresentation,
} from "../../lib/miniPlayer/presentation"
import {
  normalizeSessionIdentity,
  sessionIdentityKey,
} from "../../lib/miniPlayer/session"
import type { MiniPlayerStore } from "../../lib/miniPlayer/store"
import type { SheetCounter } from "../../lib/miniPlayer/suppression"
import type { SessionEndReason } from "../../lib/miniPlayer/types"
// Not from VideoPlayer.tsx: the root layout mounts this host, so importing it
// there dragged the whole player UI plus expo-blur/image/linear-gradient into
// the cold-launch graph.
import { applyWatchBufferOptions } from "../../lib/playerBufferOptions"

export {
  MINI_PLAYER_KEEPALIVE_SLOT,
  MINI_PLAYER_WINDOW_SLOT,
} from "./MiniPlayerWindow"

/**
 * Bottom chrome the window insets inside on a tab route. The tab bar is drawn
 * by the navigator, which this host cannot measure, so the platform default
 * height stands in for it (R7).
 */
const TAB_BAR_HEIGHT = Platform.OS === "ios" ? 49 : 56

type RegisterSessionEnd = (listener: SessionEndListener) => () => void

export type PlaybackHostProps = {
  store?: MiniPlayerStore
  sheets?: SheetCounter
  registerEnd?: RegisterSessionEnd
  useRouteSegments?: () => readonly string[]
  /** R23: does the navigator have somewhere to go back to? */
  canGoBack?: () => boolean
  /** R4/KTD11: injected, because the window must not import the router. */
  navigateToVideo?: (video: MiniPlayerWindowVideo) => void
}

/* eslint-disable @typescript-eslint/no-require-imports */
/** Lazy so the module graph of this file never reaches expo-router at import,
 *  which is what keeps the host renderable under jest. */
function useExpoRouterSegments(): readonly string[] {
  return (require("expo-router") as typeof import("expo-router")).useSegments()
}

function expoRouterCanGoBack(): boolean {
  return (
    require("expo-router") as typeof import("expo-router")
  ).router.canGoBack()
}

function expoRouterNavigateToVideo(video: MiniPlayerWindowVideo): void {
  const slug = video.videoSlug
  if (slug == null || slug === "") return
  ;(require("expo-router") as typeof import("expo-router")).router.push(
    `/watch/${encodeURIComponent(slug)}` as never,
  )
}
/* eslint-enable @typescript-eslint/no-require-imports */

export function PlaybackHost({
  store = getMiniPlayerStore(),
  sheets = getMiniPlayerSheets(),
  registerEnd = registerSessionEnd,
  useRouteSegments = useExpoRouterSegments,
  canGoBack = expoRouterCanGoBack,
  navigateToVideo = expoRouterNavigateToVideo,
}: PlaybackHostProps = {}) {
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // The watch route's claim on the one player, which is what stops that route
  // creating a second one for the same video.
  const claim = useSyncExternalStore(subscribeToPlaybackClaim, getPlaybackClaim)

  const handleError = useCallback(
    (error: Error) => {
      try {
        reportDatadogError(error, { origin: "playback_host" })
      } catch {
        // Telemetry must never widen a render failure.
      }
      // Both, or the subtree never unmounts: the root boundary above has no
      // reset path, so a throw there costs an app relaunch.
      store.end("failed")
      setPlaybackClaim(null)
    },
    [store],
  )

  const active = resolveActivePlayback(claim, session)
  if (active == null) return null

  // Keyed by the session module, not a local field list: two definitions of
  // "same session" that must stay in step by hand is the divergence that
  // module exists to prevent.
  return (
    <PlaybackHostBoundary
      key={sessionIdentityKey(active)}
      onError={handleError}
    >
      <PlaybackSession
        store={store}
        sheets={sheets}
        registerEnd={registerEnd}
        useRouteSegments={useRouteSegments}
        canGoBack={canGoBack}
        navigateToVideo={navigateToVideo}
        routeOwnsSurface={claim != null}
        streamingUrl={active.streamingUrl}
        videoId={active.videoId}
        videoSlug={active.videoSlug}
        languageSlug={active.languageSlug}
      />
    </PlaybackHostBoundary>
  )
}

type PlaybackSessionProps = {
  store: MiniPlayerStore
  sheets: SheetCounter
  registerEnd: RegisterSessionEnd
  useRouteSegments: () => readonly string[]
  canGoBack: () => boolean
  navigateToVideo: (video: MiniPlayerWindowVideo) => void
  /** The watch route is mounted and holds the one video surface. */
  routeOwnsSurface: boolean
  streamingUrl: string
  videoId?: string
  videoSlug?: string
  languageSlug: string | null
}

/**
 * The one player. Memoized on the session's identity and source so the store's
 * one-second position write — which replaces the snapshot object every tick —
 * re-renders the host but not the player subtree.
 */
const PlaybackSession = memo(function PlaybackSession({
  store,
  sheets,
  registerEnd,
  useRouteSegments,
  canGoBack,
  navigateToVideo,
  routeOwnsSurface,
  streamingUrl,
  videoId,
  videoSlug,
  languageSlug,
}: PlaybackSessionProps) {
  // Normalized, never raw: an empty-string videoId reaches admin as
  // `videoId: ""` (not nullish, so the wire keeps it), and an identity with no
  // key at all would still build a recorder whose flush prompts a sign-in.
  const progress = useMemo(
    () => normalizeSessionIdentity({ videoId, videoSlug, languageSlug }),
    [videoId, videoSlug, languageSlug],
  )

  const handleProgress = useCallback(
    (positionSeconds: number, durationSeconds: number) => {
      // A poll before the source loads reports duration 0. Passing it through
      // would overwrite the session's real duration and the window would draw
      // a full progress bar over a video that just started.
      store.updateProgress(
        positionSeconds,
        durationSeconds > 0 ? durationSeconds : undefined,
      )
    },
    [store],
  )

  const { player, isPlaying, endSession } = useManagedVideoPlayer(
    streamingUrl,
    applyWatchBufferOptions,
    { progress, onProgress: handleProgress },
  )

  // A store-driven end (dismiss, sign-out) has to reach the live player before
  // this subtree unmounts, or teardown files the session as an abandonment.
  const endAndClearSheets = useCallback(
    (reason: SessionEndReason) => {
      // The WHOLE body: the registry swallows a throw, so a failing flush would
      // skip the release in silence — and closeSheet() floors at zero, so one
      // stranded count hides every later window until relaunch.
      try {
        endSession(reason)
      } finally {
        sheets.reset()
      }
    },
    [endSession, sheets],
  )
  useEffect(
    () => registerEnd(endAndClearSheets),
    [registerEnd, endAndClearSheets],
  )

  const handlePlayPause = useCallback(() => {
    try {
      if (player.playing) player.pause()
      else player.play()
    } catch {
      // Player already released. Dismiss stays the viewer's way out.
    }
  }, [player])

  const handleDismiss = useCallback(() => store.end("dismissed"), [store])
  const handleEnded = useCallback(() => store.end("ended"), [store])

  // R22 closes the QUALITY session, not the mini player session: ending the
  // latter unmounts the window, and the failure state must stay operable.
  const handleFailure = useCallback(() => endSession("failed"), [endSession])

  return (
    <MiniPlayerWindowSlot
      store={store}
      player={player}
      isPlaying={isPlaying}
      sheets={sheets}
      useRouteSegments={useRouteSegments}
      canGoBack={canGoBack}
      navigateToVideo={navigateToVideo}
      routeOwnsSurface={routeOwnsSurface}
      onPlayPause={handlePlayPause}
      onDismiss={handleDismiss}
      onEnded={handleEnded}
      onFailure={handleFailure}
      videoId={videoId}
      videoSlug={videoSlug}
    />
  )
})

type MiniPlayerWindowSlotProps = {
  store: MiniPlayerStore
  player: VideoPlayer
  isPlaying: boolean
  sheets: SheetCounter
  useRouteSegments: () => readonly string[]
  canGoBack: () => boolean
  navigateToVideo: (video: MiniPlayerWindowVideo) => void
  routeOwnsSurface: boolean
  onPlayPause: () => void
  onDismiss: () => void
  onEnded: () => void
  onFailure: () => void
  videoId?: string
  videoSlug?: string
}

/**
 * The leaf that reads the route. It is deliberately the innermost component:
 * subscribing the root to the router store re-renders ApolloProvider, every
 * context and the whole Stack on each navigation.
 *
 * It also arms R23's back handler, and hands the window the live screen and
 * chrome so the window itself stays free of react-native-safe-area-context.
 */
function MiniPlayerWindowSlot({
  store,
  player,
  isPlaying,
  sheets,
  useRouteSegments,
  canGoBack,
  navigateToVideo,
  routeOwnsSurface,
  onPlayPause,
  onDismiss,
  onEnded,
  onFailure,
  videoId,
  videoSlug,
}: MiniPlayerWindowSlotProps) {
  const segments = useRouteSegments()
  const sheetCount = useSyncExternalStore(sheets.subscribe, sheets.getCount)
  const pipActive = useSyncExternalStore(
    subscribeToPictureInPicture,
    isPictureInPictureActive,
  )
  const view = useMemo(() => ({ videoId, videoSlug }), [videoId, videoSlug])
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const presentation = presentationFor(view, segments, {
    sheetCount,
    pipActive,
  })

  // The route and this window must never both hold a video view: Android
  // asserts on two views owning one player. The claim, not the route's own
  // views, decides who owns it — it outlives them by one commit either way.
  const windowPresentation: MiniPlayerPresentation = routeOwnsSurface
    ? "full"
    : presentation === "full"
      ? "hidden"
      : presentation
  const surfaceFree =
    windowPresentation === "full" || windowPresentation === "none"

  const identityKey = sessionIdentityKey({ videoId, videoSlug })
  // Published AFTER the commit that mounted or unmounted this window's surface,
  // which is what makes `surfaceFree` a promise rather than an intention.
  useEffect(() => {
    setHostPlayer({ player, identityKey, isPlaying, surfaceFree })
  }, [player, identityKey, isPlaying, surfaceFree])
  // Unmount only. Clearing it from the effect above would blank the borrowed
  // player on every play/pause and unmount the route's surface with it.
  useEffect(() => () => setHostPlayer(null), [])

  useEffect(() => {
    // R23, the ONE deliberate exception to "back is never intercepted", and it
    // is armed only here — this leaf exists only while a session does.
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (canGoBack()) return false
        onDismiss()
        return true
      },
    )
    return () => subscription.remove()
  }, [canGoBack, onDismiss])

  const screen = useMemo(() => ({ width, height }), [width, height])
  const chrome = useMemo(
    () => ({
      top: insets.top,
      bottom: insets.bottom + (segments[0] === "(tabs)" ? TAB_BAR_HEIGHT : 0),
      left: insets.left,
      right: insets.right,
    }),
    [insets.top, insets.bottom, insets.left, insets.right, segments],
  )

  // Measured on Android: a VideoView that FIRST attaches to an already-playing
  // surfaceless player is permanently DEAD, and only a new player recovers it.
  // Every presentation but `full` mounts one, and `full` means the route does.
  return (
    <MiniPlayerWindowSurface
      store={store}
      presentation={windowPresentation}
      player={player}
      isPlaying={isPlaying}
      screen={screen}
      chrome={chrome}
      onExpand={navigateToVideo}
      onDismiss={onDismiss}
      onPlayPause={onPlayPause}
      onEnded={onEnded}
      onFailure={onFailure}
      videoId={videoId}
      videoSlug={videoSlug}
    />
  )
}

type MiniPlayerWindowSurfaceProps = Omit<
  MiniPlayerWindowProps,
  "video" | "player"
> & {
  store: MiniPlayerStore
  player: VideoPlayer
  videoId?: string
  videoSlug?: string
}

/**
 * The only node that re-renders at the one-second position cadence (KTD2).
 * The route read stays in its parent on purpose: a tick must not re-read the
 * router, and a navigation must not re-read the position.
 */
function MiniPlayerWindowSurface({
  store,
  videoId,
  videoSlug,
  ...windowProps
}: MiniPlayerWindowSurfaceProps) {
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot)

  const video = useMemo(
    () => ({
      videoId,
      videoSlug,
      title: session?.title ?? null,
      posterUrl: session?.posterUrl ?? null,
      positionSeconds: session?.positionSeconds ?? 0,
      durationSeconds: session?.durationSeconds ?? 0,
    }),
    [
      videoId,
      videoSlug,
      session?.title,
      session?.posterUrl,
      session?.positionSeconds,
      session?.durationSeconds,
    ],
  )

  return <MiniPlayerWindow {...windowProps} video={video} />
}

/**
 * The host's own boundary. The root ErrorBoundary has no reset path, so a
 * throw from the player subtree would otherwise cost an app relaunch. Scope:
 * everything below `PlaybackHost`'s store read — the read itself is three
 * lines over a store this app owns.
 */
class PlaybackHostBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
