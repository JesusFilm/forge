/**
 * The root-owned playback host (U6/KTD2).
 *
 * It owns the ONE expo-video player for whatever the mini player store says is
 * playing, so the player outlives the watch route. It mounts exactly one
 * VideoView for that player and never fewer: the window chrome is still U7's,
 * but the SURFACE cannot wait for it (see MiniPlayerWindowSlot).
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
import { Platform, StyleSheet, View } from "react-native"
import { VideoView } from "expo-video"
import type { ErrorInfo, ReactNode } from "react"
import type { VideoPlayer } from "expo-video"

import { useManagedVideoPlayer } from "../../hooks/useManagedVideoPlayer"
import { reportDatadogError } from "../../lib/datadog"
import {
  getMiniPlayerSheets,
  getMiniPlayerStore,
  registerSessionEnd,
} from "../../lib/miniPlayer"
import type { SessionEndListener } from "../../lib/miniPlayer/endRegistry"
import {
  isPictureInPictureActive,
  subscribeToPictureInPicture,
} from "../../lib/miniPlayer/pipLatch"
import { presentationFor } from "../../lib/miniPlayer/presentation"
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

/** The node U7 replaces with the floating window. */
export const MINI_PLAYER_WINDOW_SLOT = "mini-player-window-slot"

/** The same surface while the window is suppressed — see MiniPlayerWindowSlot. */
export const MINI_PLAYER_KEEPALIVE_SLOT = "mini-player-keepalive-slot"

type RegisterSessionEnd = (listener: SessionEndListener) => () => void

export type PlaybackHostProps = {
  store?: MiniPlayerStore
  sheets?: SheetCounter
  registerEnd?: RegisterSessionEnd
  useRouteSegments?: () => readonly string[]
}

/* eslint-disable @typescript-eslint/no-require-imports */
/** Lazy so the module graph of this file never reaches expo-router at import,
 *  which is what keeps the host renderable under jest. */
function useExpoRouterSegments(): readonly string[] {
  return (require("expo-router") as typeof import("expo-router")).useSegments()
}
/* eslint-enable @typescript-eslint/no-require-imports */

export function PlaybackHost({
  store = getMiniPlayerStore(),
  sheets = getMiniPlayerSheets(),
  registerEnd = registerSessionEnd,
  useRouteSegments = useExpoRouterSegments,
}: PlaybackHostProps = {}) {
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot)

  const handleError = useCallback(
    (error: Error) => {
      try {
        reportDatadogError(error, { origin: "playback_host" })
      } catch {
        // Telemetry must never widen a render failure.
      }
      // Ending the session unmounts this subtree, which IS the reset path: the
      // root boundary above has none, so a throw there costs an app relaunch.
      store.end("failed")
    },
    [store],
  )

  if (session == null) return null

  // Keyed by the session module, not a local field list: two definitions of
  // "same session" that must stay in step by hand is the divergence that
  // module exists to prevent.
  return (
    <PlaybackHostBoundary
      key={sessionIdentityKey(session)}
      onError={handleError}
    >
      <PlaybackSession
        store={store}
        sheets={sheets}
        registerEnd={registerEnd}
        useRouteSegments={useRouteSegments}
        streamingUrl={session.streamingUrl}
        videoId={session.videoId}
        videoSlug={session.videoSlug}
        languageSlug={session.languageSlug ?? null}
      />
    </PlaybackHostBoundary>
  )
}

type PlaybackSessionProps = {
  store: MiniPlayerStore
  sheets: SheetCounter
  registerEnd: RegisterSessionEnd
  useRouteSegments: () => readonly string[]
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

  const { player, endSession } = useManagedVideoPlayer(
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

  return (
    <MiniPlayerWindowSlot
      player={player}
      sheets={sheets}
      useRouteSegments={useRouteSegments}
      videoId={videoId}
      videoSlug={videoSlug}
    />
  )
})

type MiniPlayerWindowSlotProps = {
  player: VideoPlayer
  sheets: SheetCounter
  useRouteSegments: () => readonly string[]
  videoId?: string
  videoSlug?: string
}

/**
 * The leaf that reads the route. It is deliberately the innermost component:
 * subscribing the root to the router store re-renders ApolloProvider, every
 * context and the whole Stack on each navigation.
 *
 * It also owns the host's ONE video surface, which stays mounted through every
 * suppression — see the render below.
 */
function MiniPlayerWindowSlot({
  player,
  sheets,
  useRouteSegments,
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

  const presentation = presentationFor(view, segments, {
    sheetCount,
    pipActive,
  })

  // Measured on Android: a VideoView that FIRST attaches to an already-playing
  // surfaceless player gets a permanently DEAD surface, and only a new player
  // recovers it. So the surface outlives every suppression; U7 owns the chrome.
  return (
    <View
      testID={
        presentation === "floating"
          ? MINI_PLAYER_WINDOW_SLOT
          : MINI_PLAYER_KEEPALIVE_SLOT
      }
      style={styles.slot}
      // On the CONTAINER, never on the video view — the plan forbids that, and
      // U7's tap-to-expand target lives on this surface.
      pointerEvents="none"
    >
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="contain"
        // iOS 16+ defaults this TRUE, which floats a Live Text "scan" button
        // over any frame with text in it — a system control we do not own.
        allowsVideoFrameAnalysis={false}
        // textureView composites inside the RN hierarchy; an Android
        // SurfaceView punches through whatever is layered over it.
        surfaceType={Platform.OS === "android" ? "textureView" : undefined}
      />
    </View>
  )
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

const styles = StyleSheet.create({
  // 1x1 and fully transparent, not 0x0: a zero-size view can be laid out
  // without ever creating the native surface, which is the exact state the
  // keep-alive mount exists to prevent. U7 sizes and reveals the window.
  slot: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
})
