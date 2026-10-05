/**
 * The Explore screen: it joins the reducer, the two feed players, the pager,
 * the clip gate, and the clip queue. The route mounts it at the tab's first
 * focus, so nothing runs before that (R46, KTD13).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import type { VideoPlayer } from "expo-video"

import { ClipOverlay, type ExploreVideoRegion } from "./ClipOverlay"
import {
  ExplorePager,
  type ExplorePagerAccessibility,
  type ExplorePagerHandle,
  type ExplorePagerMove,
  type ExplorePagerRole,
  type ExplorePagerSlot,
  type ExplorePagerUnderlay,
} from "./ExplorePager"
import { ClipFailed, ExploreStates } from "./ExploreStates"
import { FeedVideoView } from "./FeedVideoView"
import { PlayerLoadingVeil } from "../watch/PlayerLoadingVeil"
import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import { useT } from "../../i18n/useT"
import { clipPosterUri, useClipAutostart } from "../../hooks/useClipAutostart"
import { usePlayingSize } from "../../hooks/usePlayingSize"
import { useReduceMotion } from "../../hooks/useReduceMotion"
import { useExploreClipQueue } from "../../hooks/useExploreClipQueue"
import { useExploreTakeover } from "../../hooks/useExploreTakeover"
import {
  useFeedPlayers,
  type FeedPlayerFailure,
} from "../../hooks/useFeedPlayers"
import { BLACK } from "../../lib/color"
import { readAppVersion } from "../../lib/explore/appVersion"
import {
  createClipEvidenceForFeed,
  type ClipEvidence,
} from "../../lib/explore/clipEvidence"
import {
  getClipRecordStore,
  type ClipRecordInput,
} from "../../lib/explore/clipRecord"
import { getDemotionStore } from "../../lib/explore/demotionStore"
import { readDeviceTier } from "../../lib/explore/deviceTier"
import {
  BLUR_RELEASE_GRACE_MS,
  INITIAL_FEED_STATE,
  activeSlot,
  canSwipeNext,
  canSwipePrevious,
  currentClip,
  feedReducer,
  needsClip,
  nextClip,
  previousClip,
  releaseRequest,
  standbySlot,
  veilVisible,
  type FeedEvent,
  type FeedState,
  type PlayerId,
} from "../../lib/explore/feedState"
import {
  bandAspect,
  clipContentFit,
  clipFraming,
} from "../../lib/explore/framing"
import {
  resolvePlayerMode,
  type PlayerMode,
} from "../../lib/explore/playerMode"
import { readSeconds, safely } from "../../lib/explore/playerRead"
import {
  getExploreTelemetry,
  type ExploreMoveTrigger,
} from "../../lib/explore/telemetry"
import type { ReadyClip, FeedClip } from "../../lib/explore/types"
import { openKeepWatching } from "../../lib/explore/watchIntent"

const BOTH_PLAYERS: readonly PlayerId[] = ["a", "b"]

/** KTD3 at the first focus. Nothing here blocks the first clip for long. */
async function launchPlayerMode(): Promise<PlayerMode> {
  const storedDemotion = await getDemotionStore().read()
  return resolvePlayerMode({
    platform: Platform.OS,
    totalMemoryBytes: readDeviceTier().totalMemoryBytes,
    standbyErrorsThisLaunch: 0,
    storedDemotion,
    appVersion: readAppVersion(),
    nowMs: Date.now(),
  })
}

/** Null until the first focus has resolved the player mode. */
function useLaunchPlayerMode(): PlayerMode | null {
  const [mode, setMode] = useState<PlayerMode | null>(null)
  useEffect(() => {
    let live = true
    void launchPlayerMode().then(
      (next) => {
        if (live) setMode(next)
      },
      () => {
        if (live) setMode("two")
      },
    )
    return () => {
      live = false
    }
  }, [])
  return mode
}

/**
 * The feed views to mount: the active one only in one-player mode (KTD3). After
 * "Keep watching", none until the next focus: the device probe could not show
 * that a cleared source frees its decoder on a low-end Android phone (KTD13).
 */
function mountedViews(state: FeedState): readonly PlayerId[] {
  if (state.phase === "unvisited") return []
  if (state.phase === "blurred" && state.blur?.cause === "keepWatching") {
    return []
  }
  return state.playerMode === "one" ? [state.active] : BOTH_PLAYERS
}

/** The neighbour page whose clip the standby holds, if any. */
function standbyRole(state: FeedState): "next" | "previous" | null {
  const standby = standbySlot(state)
  if (standby == null) return null
  if (standby.clip === nextClip(state)) return "next"
  if (standby.clip === previousClip(state)) return "previous"
  return null
}

/** A standby that holds no neighbour waits under the next page's cover. */
function viewRole(state: FeedState, player: PlayerId): ExplorePagerRole {
  if (player === state.active) return "current"
  return standbyRole(state) ?? "next"
}

/** AE8: a loaded standby shows its own first frame, so its page needs no cover. */
function pageShowsStandby(state: FeedState, role: ExplorePagerRole): boolean {
  return standbySlot(state)?.status === "ready" && standbyRole(state) === role
}

function clipFor(state: FeedState, role: ExplorePagerRole): FeedClip | null {
  if (role === "current") return currentClip(state)
  return role === "next" ? nextClip(state) : previousClip(state)
}

/** The active clip's asset time, or null while no frame of it has shown. */
function clipPosition(state: FeedState, player: VideoPlayer): number | null {
  if (state.phase !== "playing" && state.phase !== "paused") return null
  return readSeconds(() => player.currentTime)
}

/** KTD6: the first clip moved, failed, or loaded under a held pause. */
function firstClipSettled(state: FeedState): boolean {
  return (
    state.confirmedToken != null ||
    state.phase === "paused" ||
    state.phase === "clipFailed" ||
    state.cursor > 0
  )
}

function recordEntry(clip: FeedClip): ClipRecordInput {
  return {
    videoId: clip.videoId,
    languageSlug: clip.feedLanguageSlug,
    startSeconds: clip.window.startSeconds,
    endSeconds: clip.window.endSeconds,
  }
}

export type ExploreFeedProps = {
  /** The tab is on screen now. The route mounts the feed at the first focus. */
  focused: boolean
}

export function ExploreFeed({ focused }: ExploreFeedProps) {
  const router = useRouter()
  const telemetry = getExploreTelemetry()
  const { exploreMuted, setExploreMuted } = useWatchPreferences()
  const [state, dispatch] = useReducer(feedReducer, INITIAL_FEED_STATE)
  const [gestureActive, setGestureActive] = useState(false)
  const launchMode = useLaunchPlayerMode()
  const { yieldsToRoot } = useExploreTakeover({
    focused,
    onSystemPause: () => dispatch({ type: "systemPause" }),
  })

  // ── Clip evidence (KTD9): the active clip only ──────────────────────
  const evidence = useRef<ClipEvidence | null>(null)
  const active = activeSlot(state)
  const evidenceToken = active?.token ?? null
  const evidenceMediaId = active?.clip.videoId ?? null
  const evidenceStart = active?.clip.window.startSeconds ?? null
  // A layout effect runs before the players' effect in any hook order, and a
  // preloaded swipe plays in that effect. StrictMode's remount disposes the
  // evidence, so this makes another.
  useLayoutEffect(() => {
    evidence.current ??= createClipEvidenceForFeed()
    evidence.current.setClip(
      evidenceToken == null || evidenceMediaId == null || evidenceStart == null
        ? null
        : {
            token: evidenceToken,
            mediaId: evidenceMediaId,
            windowStartSeconds: evidenceStart,
          },
    )
  }, [evidenceToken, evidenceMediaId, evidenceStart])

  const handleClipFailed = useCallback(
    (failure: FeedPlayerFailure) =>
      telemetry.clipFailed({
        failure: failure.kind,
        slot: failure.active ? "active" : "standby",
        videoId: failure.clip.videoId,
        feedLanguageSlug: failure.clip.feedLanguageSlug,
        errorMessage: failure.errorMessage,
      }),
    [telemetry],
  )

  // Per player: its view has drawn a frame of the source it holds. A replay of
  // the same stream is a seek, and expo-video sends no new first frame for it.
  const [framed, setFramed] = useState<Record<PlayerId, boolean>>({
    a: false,
    b: false,
  })
  const markFramed = useCallback((player: PlayerId, value: boolean) => {
    setFramed((last) =>
      last[player] === value ? last : { ...last, [player]: value },
    )
  }, [])

  const pager = useRef<ExplorePagerHandle>(null)
  // Read by the move's commit, which lands after the settle, or at once
  // with Reduce Motion on.
  const moveTrigger = useRef<ExploreMoveTrigger>("viewer")

  const { players, activePlayer, seekActive } = useFeedPlayers({
    state,
    dispatch,
    muted: exploreMuted,
    yieldsToRoot,
    onLoop: (token) => evidence.current?.onLoop(token),
    // The owner (2026-09-30), changing R8: an ended clip moves the feed on
    // with the swipe's own settle. It loops when the pager cannot move.
    onClipEnd: () => {
      moveTrigger.current = "clipEnd"
      const moved = pager.current?.requestMove("next") ?? false
      if (!moved) moveTrigger.current = "viewer"
      return moved
    },
    onSourceSet: (_token, player) => {
      // Only the first clip's stages count, and the standby loads after it moves.
      telemetry.firstMotionStage("sourceSet")
      markFramed(player, false)
    },
    onSourceLoaded: () => telemetry.firstMotionStage("sourceLoaded"),
    onRebuffer: () => telemetry.rebuffer(),
    onClipFailed: handleClipFailed,
  })

  // Native and navigation callbacks read the last commit.
  const live = useRef({ state, activePlayer, focused, launchMode })
  live.current = { state, activePlayer, focused, launchMode }

  // Only the active player's events count. A tick counts only once this clip
  // has loaded: until then the player can still show the source it replaces.
  useEffect(() => {
    const subscriptions = BOTH_PLAYERS.flatMap((id) => {
      const player = players[id]
      // A loaded clip's duration does not change, so read it once per clip.
      let durationToken: number | null = null
      let duration = 0
      return [
        player.addListener("playingChange", ({ isPlaying }) => {
          const { state: last } = live.current
          const slot = activeSlot(last)
          if (id !== last.active || slot == null) return
          const position =
            readSeconds(() => player.currentTime) ?? slot.startAtSeconds
          evidence.current?.onPlayingChange(slot.token, isPlaying, position)
        }),
        player.addListener("timeUpdate", ({ currentTime }) => {
          const { state: last } = live.current
          const slot = activeSlot(last)
          if (id !== last.active || slot?.status !== "ready") return
          if (durationToken !== slot.token || !(duration > 0)) {
            durationToken = slot.token
            duration = readSeconds(() => player.duration) ?? 0
          }
          evidence.current?.onTime(slot.token, currentTime, duration)
          telemetry.clipProgress(
            String(last.cursor),
            currentTime - slot.clip.window.startSeconds,
          )
        }),
      ]
    })
    return () => {
      // The players' own cleanup can release a player first.
      for (const subscription of subscriptions) {
        safely(() => subscription.remove())
      }
    }
  }, [players, telemetry])

  useEffect(
    () => () => {
      evidence.current?.dispose()
      evidence.current = null
    },
    [],
  )

  // Latched in render, so the commit that settles the first clip already
  // frees the lookahead.
  const [firstClipDone, setFirstClipDone] = useState(false)
  if (firstClipSettled(state) && !firstClipDone) setFirstClipDone(true)

  const handleClip = useCallback(
    (clip: ReadyClip) => {
      telemetry.firstMotionStage("clipQueued")
      dispatch({ type: "clipQueued", clip })
    },
    [telemetry],
  )
  const queue = useExploreClipQueue({
    focused,
    gestureActive,
    holdLookahead: !firstClipDone,
    playerMode: state.playerMode,
    wantsClip: needsClip(state),
    feedHoldsQueued: state.queued != null,
    currentClip: currentClip(state),
    nextClip: nextClip(state),
    onClip: handleClip,
    onPoolReady: telemetry.poolReady,
    onPoolFallback: telemetry.poolFallback,
  })

  // The gate's timeout is the one clip failure the players do not see.
  const dispatchFromGate = useCallback(
    (event: FeedEvent) => {
      const slot = activeSlot(live.current.state)
      if (event.type === "timeout" && slot?.token === event.token) {
        telemetry.clipFailed({
          failure: "timeout",
          slot: "active",
          videoId: slot.clip.videoId,
          feedLanguageSlug: slot.clip.feedLanguageSlug,
          errorMessage: null,
        })
      }
      dispatch(event)
    },
    [telemetry],
  )
  const veil = useClipAutostart({
    state,
    dispatch: dispatchFromGate,
    yieldsToRoot,
    stillUri: queue.stillUri,
    stillLoaded: queue.stillLoaded,
  })

  // ── Focus, blur, and the background (KTD13, R45) ────────────────────
  useEffect(() => {
    if (launchMode == null) return
    if (focused) {
      telemetry.focus(launchMode)
      dispatch({ type: "focus", playerMode: launchMode })
      return
    }
    telemetry.blur()
    const { state: last, activePlayer: player } = live.current
    dispatch({ type: "blur", positionSeconds: clipPosition(last, player) })
  }, [focused, launchMode, telemetry])

  // As on Home's hero: any state but "active" pauses. The Android share
  // chooser sends "background", so the clip stays paused under it.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const current = live.current
      if (next === "active") {
        if (current.focused && current.launchMode != null) {
          telemetry.focus(current.launchMode)
          dispatch({ type: "focus", playerMode: current.launchMode })
        }
        return
      }
      telemetry.blur()
      dispatch({
        type: "background",
        positionSeconds: clipPosition(current.state, current.activePlayer),
      })
    })
    return () => subscription.remove()
  }, [telemetry])

  const graceArmed = releaseRequest(state).active === "afterGrace"
  useEffect(() => {
    if (!graceArmed) return
    const timer = setTimeout(
      () => dispatch({ type: "graceExpired" }),
      BLUR_RELEASE_GRACE_MS,
    )
    return () => clearTimeout(timer)
  }, [graceArmed])

  // ── Queue signals, the record, and the demotion ─────────────────────
  const signal = queue.signal
  useEffect(() => {
    // KTD22: not urgent, so it waits for the gesture to end.
    if (gestureActive || signal == null) return
    dispatch({ type: signal })
  }, [signal, gestureActive])

  const motionSlot =
    active != null && active.token === state.confirmedToken ? active : null
  const motionToken = motionSlot?.token ?? null
  const motionClip = motionSlot?.clip ?? null
  const lastMotionToken = useRef<number | null>(null)
  const pendingRecords = useRef<ClipRecordInput[]>([])
  // Motion is confirmed here, and only here: a clip starts to play.
  useEffect(() => {
    if (
      motionToken != null &&
      motionClip != null &&
      motionToken !== lastMotionToken.current
    ) {
      lastMotionToken.current = motionToken
      telemetry.motionConfirmed()
      pendingRecords.current.push(recordEntry(motionClip))
    }
    // KTD22: record writes wait for the gesture. KTD15: at play, not preload.
    if (gestureActive) return
    const store = getClipRecordStore()
    for (const entry of pendingRecords.current.splice(0)) store.add(entry)
  }, [motionToken, motionClip, gestureActive, telemetry])

  useEffect(() => {
    if (!state.demotedThisLaunch) return
    telemetry.demoted(live.current.state.standbyErrors)
    void getDemotionStore().write({
      demotedAtMs: Date.now(),
      appVersion: readAppVersion(),
    })
  }, [state.demotedThisLaunch, telemetry])

  const handleMove = useCallback(
    (move: ExplorePagerMove) => {
      const last = live.current.state
      const target = move === "next" ? nextClip(last) : previousClip(last)
      const standby = standbySlot(last)
      const trigger = moveTrigger.current
      moveTrigger.current = "viewer"
      telemetry.swipe({
        preloadHit: standby?.clip === target && standby.status === "ready",
        direction: move === "next" ? "forward" : "backward",
        trigger,
      })
      dispatch({ type: move === "next" ? "swipeNext" : "swipePrevious" })
    },
    [telemetry],
  )
  const handleRest = useCallback(() => dispatch({ type: "rest" }), [])
  const handleTap = useCallback(() => dispatch({ type: "tap" }), [])
  const handleOverlayOpen = useCallback(
    () => dispatch({ type: "overlayOpen" }),
    [],
  )
  const handleOverlayClose = useCallback(
    () => dispatch({ type: "overlayClose" }),
    [],
  )
  const handleToggleMute = useCallback(
    () => setExploreMuted(!exploreMuted),
    [exploreMuted, setExploreMuted],
  )
  const retryQueue = queue.retry
  const handleRetry = useCallback(() => {
    dispatch({ type: "retry" })
    retryQueue()
  }, [retryQueue])

  const handleKeepWatching = useCallback(
    (positionSeconds: number) => {
      const last = live.current.state
      const clip = currentClip(last)
      if (clip == null) return
      // Under the veil the clip shows no frame, so the tap point is its start.
      const position = veilVisible(last) ? null : positionSeconds
      telemetry.keepWatchingTap(clip.slug)
      telemetry.blur()
      dispatch({ type: "keepWatching", positionSeconds: position })
      openKeepWatching({
        clip,
        positionSeconds: position,
        navigate: (href) => router.navigate(href),
      })
    },
    [router, telemetry],
  )

  // KTD18's band: the current overlay measures where its title starts, and
  // each view draws a landscape clip in that region, so a swipe keeps it there.
  const [videoRegion, setVideoRegion] = useState<ExploreVideoRegion | null>(
    null,
  )
  const handleVideoRegion = useCallback((next: ExploreVideoRegion) => {
    setVideoRegion((last) =>
      last?.top === next.top && last.bottom === next.bottom ? last : next,
    )
  }, [])
  const regionStyle =
    videoRegion != null
      ? [StyleSheet.absoluteFill, videoRegion]
      : StyleSheet.absoluteFill
  const [posterShapes] = useState<PosterShapes>(() => new Map())

  const views = mountedViews(state)
  const renderUnderlay = ({ pageStyle }: ExplorePagerUnderlay) =>
    views.map((player) => (
      <View
        key={player}
        testID={`explore-feed-view-${player}`}
        style={pageStyle(viewRole(state, player))}
      >
        <FeedVideoLayer
          testID={`explore-video-region-${player}`}
          player={players[player]}
          region={videoRegion}
          onFirstFrameRender={() => markFramed(player, true)}
        />
      </View>
    ))

  const current = currentClip(state)
  const currentLayers =
    current == null ? null : (
      <>
        <ClipVeil
          visible={veil.veilVisible}
          failed={veil.failed}
          uri={veil.image?.uri ?? null}
          framed={framed[state.active]}
          region={videoRegion}
          shapes={posterShapes}
          spinnerStyle={regionStyle}
        />
        {veil.failed && <ClipFailed />}
        <ClipOverlay
          clip={current}
          player={activePlayer}
          muted={exploreMuted}
          paused={state.phase === "paused" && state.overlay == null}
          onToggleMute={handleToggleMute}
          onSeek={seekActive}
          onKeepWatching={handleKeepWatching}
          onOverlayOpen={handleOverlayOpen}
          onOverlayClose={handleOverlayClose}
          onVideoRegion={handleVideoRegion}
          veiled={veil.veilVisible}
        />
      </>
    )

  const renderSlot = (slot: ExplorePagerSlot) => (
    <ClipPage
      role={slot.role}
      accessibility={slot.accessibility}
      clip={clipFor(state, slot.role)}
      covered={!pageShowsStandby(state, slot.role)}
      onTap={handleTap}
      region={videoRegion}
      posterShapes={posterShapes}
    >
      {slot.role === "current" ? currentLayers : null}
    </ClipPage>
  )

  const preparing = state.phase === "unvisited" || state.phase === "preparing"
  const stateScreen =
    state.phase === "offline" || state.phase === "empty" ? state.phase : null

  return (
    <View style={styles.root}>
      <ExplorePager
        ref={pager}
        renderSlot={renderSlot}
        renderUnderlay={renderUnderlay}
        canSwipeNext={canSwipeNext(state)}
        canSwipePrevious={canSwipePrevious(state)}
        onMove={handleMove}
        onRest={handleRest}
        onGestureLatchChange={setGestureActive}
      />
      {preparing && <PlayerLoadingVeil />}
      {stateScreen != null && (
        <ExploreStates
          phase={stateScreen}
          languageName={queue.feedLanguageName}
          onRetry={handleRetry}
        />
      )}
    </View>
  )
}

type ClipPageProps = {
  role: ExplorePagerRole
  accessibility: ExplorePagerAccessibility | null
  clip: FeedClip | null
  /** False while a loaded standby shows this page's first frame (AE8). */
  covered: boolean
  onTap: () => void
  /** Where a landscape clip's video, and so its poster, sits. */
  region: ExploreVideoRegion | null
  posterShapes: PosterShapes
  /** The current page's veil, states, and overlay. */
  children: ReactNode
}

/**
 * One pager slot. It stays mounted for its key and renders by role: the tap
 * surface and the overlay on the current page, a poster cover elsewhere.
 */
function ClipPage({
  role,
  accessibility,
  clip,
  covered,
  onTap,
  region,
  posterShapes,
  children,
}: ClipPageProps) {
  const t = useT("Explore")
  const surface = useRef<View>(null)
  const wasCurrent = useRef(role === "current")
  useEffect(() => {
    const isCurrent = role === "current"
    // After a move the focused clip is off screen, so focus follows (R35).
    if (isCurrent && !wasCurrent.current && surface.current != null) {
      AccessibilityInfo.sendAccessibilityEvent(surface.current, "focus")
    }
    wasCurrent.current = isCurrent
  }, [role])

  if (clip == null)
    return (
      <PosterCover
        testID="explore-page-cover"
        uri={null}
        region={region}
        shapes={posterShapes}
      />
    )
  if (role !== "current") {
    if (!covered) return null
    return (
      <PosterCover
        testID="explore-page-cover"
        uri={clipPosterUri(clip)}
        region={region}
        shapes={posterShapes}
      />
    )
  }
  return (
    <>
      <Pressable
        ref={surface}
        testID="explore-clip-surface"
        style={StyleSheet.absoluteFill}
        onPress={onTap}
        accessibilityRole="button"
        accessibilityLabel={clip.title}
        accessibilityHint={t("clipSurfaceAriaHint")}
        {...accessibility}
      />
      {children}
    </>
  )
}

/**
 * One feed view, framed by its own clip (owner, 2026-09-27): a portrait clip
 * fills the page, and a landscape one fits the region above the title.
 */
function FeedVideoLayer({
  testID,
  player,
  region,
  onFirstFrameRender,
}: {
  testID: string
  player: VideoPlayer
  region: ExploreVideoRegion | null
  onFirstFrameRender: () => void
}) {
  const framing = clipFraming(usePlayingSize(player))
  const style =
    framing === "band" && region != null
      ? [StyleSheet.absoluteFill, region]
      : StyleSheet.absoluteFill
  return (
    <View testID={testID} style={style}>
      <FeedVideoView
        player={player}
        contentFit={clipContentFit(framing)}
        onFirstFrameRender={onFirstFrameRender}
      />
    </View>
  )
}

/** The dim fades in, and the whole veil fades out, over this (owner, 2026-09-28). */
export const VEIL_FADE_MS = 300
/** After the gate lifts, the veil waits at most this long for a first frame. */
export const VEIL_FRAME_WAIT_MS = 2000

type ClipVeilProps = {
  /** The clip gate's veil: true while the clip loads. */
  visible: boolean
  /** R40: the clip cannot play, so no frame will come. */
  failed: boolean
  uri: string | null
  /** The active view has drawn a frame of the source its player holds. */
  framed: boolean
  region: ExploreVideoRegion | null
  shapes: PosterShapes
  spinnerStyle: StyleProp<ViewStyle>
}

/**
 * The veil's poster, dim and spinner. The gate can lift before the first frame
 * is drawn, so the poster stays until that frame (or the wait ends), then fades.
 */
function ClipVeil({
  visible,
  failed,
  uri,
  framed,
  region,
  shapes,
  spinnerStyle,
}: ClipVeilProps) {
  const reduceMotion = useReduceMotion()
  const fadeMs = reduceMotion ? 0 : VEIL_FADE_MS
  const layer = useRef(new Animated.Value(1)).current
  const dim = useRef(new Animated.Value(0)).current
  // Kept through the fade, after the gate has dropped the image.
  const [heldUri, setHeldUri] = useState(uri)
  const [shown, setShown] = useState(visible)
  if (visible && uri != null && uri !== heldUri) setHeldUri(uri)
  if (visible && !shown) setShown(true)

  // The poster is opaque at once, to hide the player's old frame; the dim fades in.
  useEffect(() => {
    if (!visible) return
    layer.stopAnimation()
    layer.setValue(1)
    dim.setValue(0)
    const fadeIn = Animated.timing(dim, {
      toValue: 1,
      duration: fadeMs,
      useNativeDriver: true,
    })
    fadeIn.start()
    return () => fadeIn.stop()
  }, [visible, layer, dim, fadeMs])

  useEffect(() => {
    if (visible || !shown) return
    let fadeOut: Animated.CompositeAnimation | null = null
    const leave = () => {
      fadeOut = Animated.timing(layer, {
        toValue: 0,
        duration: fadeMs,
        useNativeDriver: true,
      })
      fadeOut.start(({ finished }) => {
        if (finished) setShown(false)
      })
    }
    if (framed || failed) {
      leave()
      return () => fadeOut?.stop()
    }
    const wait = setTimeout(leave, VEIL_FRAME_WAIT_MS)
    return () => {
      clearTimeout(wait)
      fadeOut?.stop()
    }
  }, [visible, shown, framed, failed, layer, fadeMs])

  if (!shown) return null
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: layer }]}
      pointerEvents="none"
    >
      <PosterCover
        testID={visible ? "explore-clip-veil" : "explore-clip-veil-leaving"}
        uri={heldUri}
        region={region}
        shapes={shapes}
      />
      {/* In the band, the spinner centres on the frame, not the screen. */}
      {!failed && (
        <Animated.View
          testID="explore-clip-spinner-region"
          style={[spinnerStyle, { opacity: dim }]}
          pointerEvents="none"
        >
          <PlayerLoadingVeil />
        </Animated.View>
      )}
    </Animated.View>
  )
}

/**
 * Opaque, to hide a player's old frame. It sits where the video will (owner,
 * 2026-09-28): a landscape poster fills a band clip's 16:9 box, and a portrait
 * one fills the page.
 */
function PosterCover({
  testID,
  uri,
  region,
  shapes,
}: {
  testID: string
  uri: string | null
  region: ExploreVideoRegion | null
  shapes: PosterShapes
}) {
  // The poster's own shape, read when it loads, and only for this poster. The
  // veil is a new cover, so it starts from the shape an earlier cover read.
  const [loaded, setLoaded] = useState<{ uri: string; portrait: boolean }>()
  const portrait =
    uri != null &&
    (loaded?.uri === uri ? loaded.portrait : shapes.get(uri) === true)
  if (uri == null) {
    return <View testID={testID} style={styles.cover} pointerEvents="none" />
  }
  const image = (
    <Image
      source={uri}
      style={StyleSheet.absoluteFill}
      contentFit={portrait || region != null ? "cover" : "contain"}
      recyclingKey={uri}
      onLoad={(e) => {
        const shape = { uri, portrait: e.source.height > e.source.width }
        rememberPosterShape(shapes, shape.uri, shape.portrait)
        setLoaded(shape)
      }}
    />
  )
  return (
    <View testID={testID} style={styles.cover} pointerEvents="none">
      {portrait || region == null ? (
        image
      ) : (
        <View style={[StyleSheet.absoluteFill, region, styles.posterRegion]}>
          <View testID={`${testID}-frame`} style={styles.posterFrame}>
            {image}
          </View>
        </View>
      )}
    </View>
  )
}

/** Portrait or not, by poster uri, for the covers of one feed. */
type PosterShapes = Map<string, boolean>

/** The feed is endless; only the posters of nearby clips matter. */
const POSTER_SHAPE_LIMIT = 32

function rememberPosterShape(
  shapes: PosterShapes,
  uri: string,
  portrait: boolean,
) {
  shapes.delete(uri)
  shapes.set(uri, portrait)
  const oldest = shapes.keys().next().value
  if (shapes.size > POSTER_SHAPE_LIMIT && oldest !== undefined) {
    shapes.delete(oldest)
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BLACK },
  cover: { ...StyleSheet.absoluteFill, backgroundColor: BLACK },
  posterRegion: { justifyContent: "center" },
  // A band clip's 16:9 box: full width, centred, and never taller than the region.
  posterFrame: {
    width: "100%",
    maxHeight: "100%",
    aspectRatio: bandAspect(null),
    overflow: "hidden",
  },
})
