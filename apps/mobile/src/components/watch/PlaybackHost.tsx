/**
 * The root playback host (U6, KTD17). It owns the app's ONE player and its ONE
 * video view, mounted above the stack and absolutely positioned at the rect the
 * current surface measured for it — or, once no surface owns it, at the
 * floating window's corner (U7).
 *
 * The chrome rides in this layer too, not in the route. The host paints above
 * the stack by construction (KTD1), and the screens behind it are opaque
 * (`layout.screenContainer` in `src/styles/shared.ts`, plus the Stack's own
 * `contentStyle`), so a video view under the stack would be hidden and a video
 * view over it would cover the controls. One frame holding both preserves the
 * exact layering the component had before the hoist.
 *
 * The video view keeps ONE position in this tree in every state (KTD17): the
 * full view and the window differ only in the frame's geometry and in which
 * chrome renders beside it. Moving it would remount the surface, which is the
 * black flash R1 forbids.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  Animated,
  BackHandler,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native"
import { useRouter, useSegments } from "expo-router"
import { VideoView, type VideoPlayerStatus } from "expo-video"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useManagedVideoPlayer } from "../../hooks/useManagedVideoPlayer"
import { getAuthSession } from "../../lib/authSession"
import { BLACK } from "../../lib/color"
import {
  DEFAULT_CORNER,
  defaultCornerFrame,
  miniPlayerCornerFrame,
  type MiniPlayerCorner,
  type MiniPlayerLayoutConfig,
} from "../../lib/miniPlayer/layout"
import {
  getPlaybackRequestStore,
  sameSessionContent,
  sourceForRequest,
  type LoadedSource,
  type PlaybackRect,
  type PlaybackRequest,
  type PlaybackRequestSnapshot,
} from "../../lib/miniPlayer/playbackRequest"
import { pictureInPictureViewProps } from "../../lib/miniPlayer/pictureInPicture"
import {
  isTabRootRoute,
  miniPlayerPresentation,
} from "../../lib/miniPlayer/presentation"
import {
  getMiniPlayerStore,
  type MiniPlayerSession,
} from "../../lib/miniPlayer/store"
import {
  getNonRouteSheetCounter,
  routePattern,
} from "../../lib/miniPlayer/suppression"
import { BACK_BUTTON_PROPS } from "../../lib/playerLayout"
import type { ProgressIdentity } from "../../lib/watchProgress/recorder"
import { FloatingBackButton } from "../ui/FloatingBackButton"
import { MiniPlayerWindow } from "./MiniPlayerWindow"
import { VideoPlayer } from "./VideoPlayer"

/** KTD17's shrink: fixed duration, started when the pop commits. */
export const SHRINK_DURATION_MS = 260

/** R6's downward exit. */
export const EXIT_DURATION_MS = 220

/** Past the bottom edge, so the last frame of the exit is off screen. */
const EXIT_CLEARANCE = 24

/** The chrome gate's unconditional release — an interrupted shrink must never
 *  leave a window with no controls and no way out. */
const CHROME_RELEASE_SLACK_MS = 250

/** The exit's unconditional release — a dismissed window must clear its session
 *  even when the animation never reports back. */
const EXIT_RELEASE_SLACK_MS = 250

/** Live chrome the window may not cover (R7), read from `app/_layout.tsx` and
 *  `app/(tabs)/_layout.tsx`. Both exclude the safe-area inset, which the corner
 *  geometry already subtracts. */
const TAB_BAR_CONTENT_HEIGHT = Platform.select({
  ios: 49,
  android: 56,
  default: 49,
})
const NATIVE_HEADER_HEIGHT = Platform.select({
  ios: 44,
  android: 56,
  default: 44,
})

/** The two routes `app/_layout.tsx` gives a native header. */
const HEADER_ROUTE_PATTERNS: ReadonlySet<string> = new Set([
  "video/[sectionKey]",
  "collection/[sectionKey]",
])

/**
 * The router bridge. Everything below it is router-free so the window's target
 * and its back answer are injected rather than imported (KTD11, KTD4).
 */
export function PlaybackHost() {
  const segments = useSegments()
  const router = useRouter()

  const canGoBack = useCallback(() => {
    try {
      return router.canGoBack()
    } catch {
      return false
    }
  }, [router])

  const onExpand = useCallback(
    (session: MiniPlayerSession) => {
      router.push(`/watch/${encodeURIComponent(session.videoSlug)}` as never)
    },
    [router],
  )

  return (
    <PlaybackHostView
      segments={segments}
      canGoBack={canGoBack}
      onExpand={onExpand}
    />
  )
}

export type PlaybackHostViewProps = {
  segments: readonly string[]
  canGoBack: () => boolean
  onExpand: (session: MiniPlayerSession) => void
}

export function PlaybackHostView({
  segments,
  canGoBack,
  onExpand,
}: PlaybackHostViewProps) {
  const store = getPlaybackRequestStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const sessionStore = getMiniPlayerStore()
  const pipHeld = useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getSnapshot().pipHold,
  )

  // R25/KTD15, wired here rather than inside the player: this component is
  // mounted for the app's whole life, so the subject watch outlives every
  // session it has to end. attachAuthSession returns its own detach.
  useEffect(() => getMiniPlayerStore().attachAuthSession(getAuthSession()), [])

  // R24: an ending that is not a dismissal (a subject change, an adapter safety
  // net) drops the request while the OS window is still up, and unmounting the
  // view there fires expo-video's unguarded native path. Held, not adopted.
  const lastRequestRef = useRef<PlaybackRequest | null>(null)
  if (snapshot.request != null) lastRequestRef.current = snapshot.request
  const request = snapshot.request ?? (pipHeld ? lastRequestRef.current : null)

  // No request, no player: the app carries no native player (and no cold-launch
  // cost) until a surface asks for one, and releasing it is how a dismissed
  // session gives the decoder back.
  if (request == null) return null
  return (
    <ActivePlaybackHost
      snapshot={snapshot}
      request={request}
      segments={segments}
      canGoBack={canGoBack}
      onExpand={onExpand}
    />
  )
}

function ActivePlaybackHost({
  snapshot,
  request,
  segments,
  canGoBack,
  onExpand,
}: {
  snapshot: PlaybackRequestSnapshot
  request: PlaybackRequest
  segments: readonly string[]
  canGoBack: () => boolean
  onExpand: (session: MiniPlayerSession) => void
}) {
  const store = getPlaybackRequestStore()
  const sessionStore = getMiniPlayerStore()
  const sheetCounter = getNonRouteSheetCounter()
  const progressIdentity = useMemo<ProgressIdentity | null>(() => {
    if (request.progressVideoId != null)
      return {
        videoId: request.progressVideoId,
        languageSlug: request.progressLanguageSlug,
      }
    if (request.progressVideoSlug != null)
      return {
        videoSlug: request.progressVideoSlug,
        languageSlug: request.progressLanguageSlug,
      }
    return null
  }, [
    request.progressVideoId,
    request.progressVideoSlug,
    request.progressLanguageSlug,
  ])

  const sessionSnapshot = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
  )

  // R4: what the player already holds, so a screen remounting onto the video it
  // is playing adopts it rather than reloading it from zero.
  const loadedSourceRef = useRef<LoadedSource | null>(null)
  const requestLanguage =
    request.session?.languageSlug ?? request.progressLanguageSlug ?? null
  const adoptable =
    sessionSnapshot.session != null &&
    request.session != null &&
    sameSessionContent(request.session, sessionSnapshot.session)
  const sourceUrl = sourceForRequest({
    requested: request.streamingUrl,
    loaded: loadedSourceRef.current,
    language: requestLanguage,
    adoptable,
  })
  if (sourceUrl != null && sourceUrl === request.streamingUrl) {
    // Handed to the player, so it becomes what the player holds. A known dub is
    // never downgraded to null by a remount that has not resolved one yet.
    loadedSourceRef.current = {
      url: sourceUrl,
      languageSlug:
        requestLanguage ?? loadedSourceRef.current?.languageSlug ?? null,
    }
  }

  const { player, isPlaying } = useManagedVideoPlayer(
    sourceUrl,
    (p) => {
      // Favor a fast first frame over deep prebuffer — JFP audience skews to
      // low-bandwidth networks. (Android-only fields are ignored on iOS.)
      p.bufferOptions = {
        minBufferForPlayback: 1,
        preferredForwardBufferDuration: 8,
        prioritizeTimeOverSizeThreshold: true,
      }
    },
    { progress: progressIdentity, ownsSession: true },
  )

  const openSheetCount = useSyncExternalStore(
    sheetCounter.subscribe,
    sheetCounter.count,
  )
  const presentation = miniPlayerPresentation(
    sessionSnapshot,
    segments,
    openSheetCount,
  )
  const session = sessionSnapshot.session
  const hasSession = session != null
  const pipHeld = sessionSnapshot.pipHold
  const rect = snapshot.rect

  // The latch is fed by this view's own callbacks, so a teardown that takes the
  // view with it would strand the latch set — and a stuck hold exempts EVERY
  // adapter from the background pause (R13's decision reads one store field).
  useEffect(() => () => getMiniPlayerStore().setPipHold(false), [])

  // Admission's first half (R1): has THIS video played at all. Reset per video,
  // because a window for a video that never started is AE10's regression.
  const startedRef = useRef(false)
  // Admission's other half (R1): has THIS video already finished. Reset with
  // the same key, and cleared whenever playback runs again — a viewer who seeks
  // back from the end and plays on is watching, not finished.
  const endedRef = useRef(false)
  const videoKey = request.session
    ? `${request.session.videoId ?? ""}|${request.session.videoSlug}`
    : (request.streamingUrl ?? "")
  useEffect(() => {
    startedRef.current = false
    endedRef.current = false
  }, [videoKey])
  useEffect(() => {
    if (!isPlaying) return
    startedRef.current = true
    endedRef.current = false
  }, [isPlaying])

  useEffect(() => {
    store.setPlaybackFactsSource({
      // The live player, not the latch alone: a swap that keeps `playing` true
      // throughout emits no playing-change edge, and a latch that only an edge
      // sets would deny the arriving video its window for good.
      hasPlaybackStarted: () => {
        if (startedRef.current) return true
        try {
          return player.playing
        } catch {
          return false // Native player already released
        }
      },
      hasReachedEnd: () => endedRef.current,
      readPosition: () => {
        try {
          return player.currentTime
        } catch {
          return 0 // Native player already released
        }
      },
      readDuration: () => {
        try {
          return player.duration
        } catch {
          return 0
        }
      },
    })
    return () => store.setPlaybackFactsSource(null)
  }, [store, player])

  // R25 stops playback on a subject change, R6 on a dismissal. Neither is
  // covered by the teardown — an expanded screen keeps this host mounted, and a
  // dismissed window is exactly the case where nothing unmounts.
  useEffect(() => {
    return getMiniPlayerStore().onEnd((event) => {
      if (event.reason !== "abandoned" && event.reason !== "dismissed") return
      try {
        player.pause()
      } catch {
        // Native player already released
      }
    })
  }, [player])

  // Disable Mux's HLS subtitle tracks (SubtitleOverlay renders admin VTT
  // instead). Lives here, not in the chrome: R26 keeps the floating window
  // caption-free, and the track must stay null with no chrome mounted.
  useEffect(() => {
    const disable = () => {
      try {
        if (player.subtitleTrack != null) player.subtitleTrack = null
      } catch {
        // Player already released
      }
    }
    const subs = [
      player.addListener("availableSubtitleTracksChange", disable),
      player.addListener("subtitleTrackChange", disable),
      player.addListener("sourceLoad", disable),
    ]
    disable()
    return () => subs.forEach((s) => s.remove())
  }, [player])

  // Subscribed once per PLAYER, not per source: resubscribing on a streamingUrl
  // change rebuilds mid-replaceAsync across the seed -> canonical swap, which
  // attributes a pre-swap error to the new source.
  useEffect(() => {
    const sub = player.addListener(
      "statusChange",
      ({ status }: { status: VideoPlayerStatus }) => {
        store.setLoadFailed(status === "error")
      },
    )
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [store, player])

  // New source: clear the stop condition. Seeding from the CURRENT status
  // rather than a bare false covers a source that already failed before this
  // effect ran, which a listener alone never sees.
  useEffect(() => {
    let current: VideoPlayerStatus | null = null
    try {
      current = player.status
    } catch {
      // Player already released
    }
    store.setLoadFailed(current === "error")
  }, [store, player, request.streamingUrl])

  // ── The floating window (U7) ──────────────────────────────────────────────

  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const pattern = routePattern(segments)
  const atTabRoot = isTabRootRoute(segments)
  const underHeader = HEADER_ROUTE_PATTERNS.has(pattern)
  const layoutConfig = useMemo<MiniPlayerLayoutConfig>(
    () => ({
      screen: { width: screenWidth, height: screenHeight },
      insets: {
        top: insets.top,
        right: insets.right,
        bottom: insets.bottom,
        left: insets.left,
      },
      chrome: {
        top: underHeader ? NATIVE_HEADER_HEIGHT : 0,
        bottom: atTabRoot ? TAB_BAR_CONTENT_HEIGHT : 0,
      },
    }),
    [
      screenWidth,
      screenHeight,
      insets.top,
      insets.right,
      insets.bottom,
      insets.left,
      underHeader,
      atTabRoot,
    ],
  )
  const windowFrame = useMemo(
    () => defaultCornerFrame(layoutConfig),
    [layoutConfig],
  )

  // KTD5: the drag writes THIS node and never takes the native driver; the
  // shrink and the exit write the wrapper below it and always do.
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current
  const shrink = useRef(new Animated.Value(1)).current
  const exitY = useRef(new Animated.Value(0)).current

  const [corner, setCorner] = useState<MiniPlayerCorner>(DEFAULT_CORNER)
  const cornerRef = useRef(corner)
  cornerRef.current = corner
  const [shrinkFrom, setShrinkFrom] = useState<PlaybackRect | null>(null)
  const [chromeReady, setChromeReady] = useState(true)
  const [surfaceReleased, setSurfaceReleased] = useState(false)
  const lastRectRef = useRef<PlaybackRect | null>(null)
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (chromeTimerRef.current != null) clearTimeout(chromeTimerRef.current)
    }
  }, [])

  // One effect owns the drag node's resting offset, so a rotation, a handover
  // and a shrink can never race each other over the same value.
  useEffect(() => {
    if (rect != null) {
      lastRectRef.current = rect
      drag.setValue({ x: 0, y: 0 })
      return
    }
    const from = lastRectRef.current
    lastRectRef.current = null
    if (from == null || !hasSession) {
      const target = miniPlayerCornerFrame(layoutConfig, cornerRef.current)
      drag.setValue({
        x: target.x - windowFrame.x,
        y: target.y - windowFrame.y,
      })
      return
    }
    // A new window opens in the default corner, which is also what makes the
    // shrink arithmetic exact: there is no drag offset to subtract.
    setCorner(DEFAULT_CORNER)
    drag.setValue({ x: 0, y: 0 })
    setShrinkFrom(from)
    setChromeReady(false)
    shrink.setValue(0)
    Animated.timing(shrink, {
      toValue: 1,
      duration: SHRINK_DURATION_MS,
      useNativeDriver: true,
    }).start(() => {
      setShrinkFrom(null)
      setChromeReady(true)
    })
    if (chromeTimerRef.current != null) clearTimeout(chromeTimerRef.current)
    chromeTimerRef.current = setTimeout(
      () => setChromeReady(true),
      SHRINK_DURATION_MS + CHROME_RELEASE_SLACK_MS,
    )
  }, [rect, hasSession, layoutConfig, windowFrame, drag, shrink])

  useEffect(() => {
    if (presentation !== "exiting") {
      // The node outlives the dismissal that moved it: a session-less slot
      // (the series trailer) keeps this host mounted, so an unreset exit would
      // draw every later video off screen.
      exitY.setValue(0)
      return
    }
    const distance = screenHeight - windowFrame.y + EXIT_CLEARANCE
    const animation = Animated.timing(exitY, {
      toValue: distance,
      duration: EXIT_DURATION_MS,
      useNativeDriver: true,
    })
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const complete = () => {
      if (cancelled) return
      if (timer != null) clearTimeout(timer)
      timer = null
      getMiniPlayerStore().reportExitComplete()
    }
    // The gate's unconditional release: a driver that never calls back would
    // strand a dismissed window off screen with its session still live.
    timer = setTimeout(complete, EXIT_DURATION_MS + EXIT_RELEASE_SLACK_MS)
    animation.start(complete)
    return () => {
      cancelled = true
      animation.stop()
      if (timer != null) clearTimeout(timer)
    }
  }, [presentation, exitY, screenHeight, windowFrame])

  // R21/R22 re-arm: a replay puts the surface back before anything else reads it.
  const endedCause = session?.endedCause ?? null
  useEffect(() => {
    if (endedCause == null) setSurfaceReleased(false)
  }, [endedCause])

  // Read through a ref: these listeners are keyed on the player, and
  // re-subscribing per navigation would rebuild them mid-swap.
  const floatingRef = useRef(false)
  floatingRef.current = rect == null && hasSession

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      if (!floatingRef.current) {
        // The full view has no window to mark ended, so the fact is what
        // carries the ending to admission when this surface goes away.
        endedRef.current = true
        return
      }
      getMiniPlayerStore().markEnded("playToEnd")
    })
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [player])

  useEffect(() => {
    if (!snapshot.loadFailed || rect != null || !hasSession) return
    getMiniPlayerStore().markEnded("failure")
  }, [snapshot.loadFailed, rect, hasSession])

  // R23, KTD4's single deliberate exception. Armed only while a session is
  // active, and claims the press only when the navigator cannot go back.
  const canGoBackRef = useRef(canGoBack)
  canGoBackRef.current = canGoBack
  useEffect(() => {
    if (!hasSession) return
    // Registered on both platforms: iOS has no hardware back and RN's handler
    // is inert there, so the arming rule stays in one place.
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (canGoBackRef.current()) return false
        getMiniPlayerStore().requestDismiss()
        return true
      },
    )
    return () => subscription.remove()
  }, [hasSession])

  const handlePlayPause = useCallback(() => {
    try {
      if (player.playing) player.pause()
      else player.play()
    } catch {
      // Native player already released
    }
  }, [player])

  const handleReplay = useCallback(() => {
    try {
      player.currentTime = 0
      player.play()
      // Inside the try: a window that says "playing" over a player that refused
      // the call offers no replay control to try again with (R27).
      getMiniPlayerStore().markPlaying()
    } catch {
      // Native player already released
    }
  }, [player])

  const handleDismiss = useCallback(() => {
    getMiniPlayerStore().requestDismiss()
  }, [])

  const handleExpand = useCallback(() => {
    const current = getMiniPlayerStore().getSnapshot().session
    if (current != null) onExpand(current)
  }, [onExpand])

  const showWindow =
    hasSession && (presentation === "floating" || presentation === "exiting")
  const suppressed = hasSession && presentation === "hidden"
  const floating = rect == null && hasSession
  const geometry = rect ?? windowFrame

  // A surface can own the player before its stream resolves (an Up Next
  // replace, a seed with no playbackId). The player still holds ANOTHER route's
  // video then, so drawing it into this rect would paint the wrong one.
  const hasSurfaceVideo = request.streamingUrl != null || adoptable
  // Never gated away under the hold: unregistering the view mid-OS-window fires
  // expo-video's unguarded native path (R24).
  const drawsSurface =
    pipHeld || (hasSurfaceVideo && (rect != null || !surfaceReleased))
  // With none of the three inside it, the frame is an opaque black box over the
  // poster the sourceless screen paints beneath it.
  const drawsFrame = drawsSurface || (showWindow && session != null)

  // Both rects share the video's aspect ratio, so this is translate plus scale
  // only (KTD17).
  const shrinkStyle = useMemo(() => {
    if (shrinkFrom == null) return null
    const half = (r: PlaybackRect) => ({
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    })
    const from = half(shrinkFrom)
    const to = half(windowFrame)
    const ramp = (a: number, b: number) =>
      shrink.interpolate({ inputRange: [0, 1], outputRange: [a, b] })
    return {
      transform: [
        { translateX: ramp(from.x - to.x, 0) },
        { translateY: ramp(from.y - to.y, 0) },
        { scale: ramp(shrinkFrom.width / windowFrame.width, 1) },
      ],
    }
  }, [shrink, shrinkFrom, windowFrame])

  // Armed only while this video actually runs, so pressing Home over a paused
  // video opens no window — and kept armed through the hold, because expo-video
  // re-elects on every params change and only the elected view is re-parented.
  const automaticPip = isPlaying || pipHeld
  const pipViewProps = useMemo(
    () => pictureInPictureViewProps({ automatic: automaticPip }),
    [automaticPip],
  )

  // Detached with no session: the surface that was drawing this video is gone
  // and no window is owed. The player keeps running with no view, which is
  // audio-only rather than a released decoder. The hold is a term because the
  // OS window outlives the session that opened it (R24).
  if (rect == null && !hasSession && !pipHeld) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {drawsFrame && (
        <Animated.View
          testID="playback-frame"
          style={[
            styles.frame,
            {
              left: geometry.x,
              top: geometry.y,
              width: geometry.width,
              height: geometry.height,
            },
            // The shrink draws the video larger than this box, so it cannot clip
            // until the window has settled into its corner.
            shrinkFrom != null && styles.unclipped,
            floating && chromeReady && styles.rounded,
            suppressed && styles.suppressed,
            { transform: [{ translateX: drag.x }, { translateY: drag.y }] },
          ]}
          // Invisible over a sheet, so it must not take that sheet's touches.
          pointerEvents={suppressed ? "none" : "box-none"}
        >
          <Animated.View
            testID="playback-exit"
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateY: exitY }] },
            ]}
            pointerEvents="box-none"
          >
            <Animated.View
              testID="playback-motion"
              style={[StyleSheet.absoluteFill, shrinkStyle]}
              pointerEvents="box-none"
            >
              {/* R24: the ended fade's completion callback survives the chrome
                  unmounting, so the hold is what keeps it from releasing this
                  surface out from under a live OS window. */}
              {drawsSurface && (
                <VideoView
                  player={player}
                  style={StyleSheet.absoluteFill}
                  nativeControls={false}
                  // iOS 16+ defaults this TRUE, which floats a Live Text "scan"
                  // button over a paused/ended frame that contains text — a system
                  // control we do not own, inside chrome we do.
                  allowsVideoFrameAnalysis={false}
                  contentFit="contain"
                  {...pipViewProps}
                  // textureView composites in the RN view hierarchy on Android so
                  // the controls/captions overlay reliably renders above the video
                  // surface (SurfaceView otherwise punches through). No-op on iOS.
                  surfaceType={
                    Platform.OS === "android" ? "textureView" : undefined
                  }
                />
              )}
            </Animated.View>

            {/* Transport chrome for something unplayable would be a lie:
                nothing to scrub, a play button over a poster that never starts. */}
            {rect != null && hasSurfaceVideo && (
              <VideoPlayer
                player={player}
                isPlaying={isPlaying}
                loadFailed={snapshot.loadFailed}
                streamingUrl={request.streamingUrl}
                posterUrl={request.posterUrl}
                subtitleVttSrc={request.subtitleVttSrc}
                fullscreen={request.fullscreen}
                onToggleFullscreen={request.onToggleFullscreen ?? undefined}
                resumeAtSeconds={request.resumeAtSeconds}
                autostart={request.autostart}
                adopted={adoptable}
              />
            )}

            {showWindow && session != null && (
              <MiniPlayerWindow
                frame={windowFrame}
                layout={layoutConfig}
                drag={drag}
                corner={corner}
                onCornerChange={setCorner}
                title={session.title}
                posterUrl={session.posterUrl}
                positionSeconds={session.positionSeconds}
                durationSeconds={session.durationSeconds}
                isPlaying={isPlaying}
                endedCause={session.endedCause}
                ready={chromeReady}
                onPlayPause={handlePlayPause}
                onReplay={handleReplay}
                onDismiss={handleDismiss}
                onExpand={handleExpand}
                onEndedFadeComplete={() => setSurfaceReleased(true)}
              />
            )}
          </Animated.View>
        </Animated.View>
      )}

      {/* The screen's back affordance sits OVER the player, so it moves up with
          the video — outside the frame, so its safe-area maths still resolves
          against the window. Gated on the SAME predicate the screen drops its
          own by (usePlaybackFrameVisible), or the measurement gap draws two. */}
      {snapshot.slotId != null && rect != null && !request.fullscreen && (
        <FloatingBackButton {...BACK_BUTTON_PROPS} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    position: "absolute",
    backgroundColor: BLACK,
    overflow: "hidden",
  },
  unclipped: {
    overflow: "visible",
  },
  rounded: {
    borderRadius: 10,
  },
  suppressed: {
    opacity: 0,
  },
})
