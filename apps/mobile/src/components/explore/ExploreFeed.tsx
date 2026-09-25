/**
 * The Explore feed (U18): the reducer, the two feed players, the pager, the
 * per-clip gate, and the clip queue in one screen. The route mounts it at the
 * tab's first focus, so nothing here runs before that (R46, KTD13).
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  AccessibilityInfo,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import type { VideoPlayer } from "expo-video"

import { ClipOverlay } from "./ClipOverlay"
import {
  ExplorePager,
  type ExplorePagerAccessibility,
  type ExplorePagerMove,
  type ExplorePagerRole,
  type ExplorePagerSlot,
  type ExplorePagerUnderlay,
} from "./ExplorePager"
import { ClipFailed, ExploreStates } from "./ExploreStates"
import { FeedVideoView } from "./FeedVideoView"
import { PlayerLoadingVeil } from "../watch/PlayerLoadingVeil"
import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import { clipPosterUri, useClipAutostart } from "../../hooks/useClipAutostart"
import { useExploreClipQueue } from "../../hooks/useExploreClipQueue"
import { useFeedPlayers } from "../../hooks/useFeedPlayers"
import { BLACK } from "../../lib/color"
import { readAppVersion } from "../../lib/explore/appVersion"
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
  type FeedState,
  type PlayerId,
} from "../../lib/explore/feedState"
import { EXPLORE_FRAMING, clipContentFit } from "../../lib/explore/framing"
import {
  resolvePlayerMode,
  type PlayerMode,
} from "../../lib/explore/playerMode"
import type { ReadyClip, FeedClip } from "../../lib/explore/types"
import { openKeepWatching } from "../../lib/explore/watchIntent"
import { deriveLanguageDisplay } from "../../lib/language-display"

const CONTENT_FIT = clipContentFit(EXPLORE_FRAMING)

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
 * The feed views to mount. One-player mode keeps only the active one (KTD3).
 * "Keep watching" unmounts both until the next focus: U1 could not show that
 * a cleared source frees its decoder on a low-end Android phone (KTD13).
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
  try {
    const time = player.currentTime
    return Number.isFinite(time) ? time : null
  } catch {
    // A released player throws on property access.
    return null
  }
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
  const { exploreMuted, setExploreMuted } = useWatchPreferences()
  const [state, dispatch] = useReducer(feedReducer, INITIAL_FEED_STATE)
  const [gestureActive, setGestureActive] = useState(false)
  const launchMode = useLaunchPlayerMode()
  // KTD10: the takeover supplies this, and the root `playing` edge sends
  // `systemPause`. Until it lands, no clip waits for the root player.
  const yieldsToRoot = false

  const { players, activePlayer } = useFeedPlayers({
    state,
    dispatch,
    muted: exploreMuted,
    yieldsToRoot,
  })

  const settledNow = firstClipSettled(state)
  const [firstClipDone, setFirstClipDone] = useState(false)
  useEffect(() => {
    if (settledNow) setFirstClipDone(true)
  }, [settledNow])

  const handleClip = useCallback(
    (clip: ReadyClip) => dispatch({ type: "clipQueued", clip }),
    [],
  )
  const queue = useExploreClipQueue({
    hasFocused: true,
    focused,
    gestureActive,
    holdLookahead: !(firstClipDone || settledNow),
    playerMode: state.playerMode,
    wantsClip: needsClip(state),
    feedHoldsQueued: state.queued != null,
    currentClip: currentClip(state),
    nextClip: nextClip(state),
    onClip: handleClip,
  })

  const veil = useClipAutostart({
    state,
    dispatch,
    yieldsToRoot,
    stillUri: queue.stillUri,
    stillLoaded: queue.stillLoaded,
  })

  // Native and navigation callbacks read the last commit.
  const live = useRef({ state, activePlayer, focused, launchMode })
  live.current = { state, activePlayer, focused, launchMode }

  // ── Focus, blur, and the background (KTD13, R45) ────────────────────
  useEffect(() => {
    if (launchMode == null) return
    if (focused) {
      dispatch({ type: "focus", playerMode: launchMode })
      return
    }
    const { state: last, activePlayer: player } = live.current
    dispatch({ type: "blur", positionSeconds: clipPosition(last, player) })
  }, [focused, launchMode])

  // As on Home's hero: any state but "active" pauses. The Android share
  // chooser sends "background", so the clip stays paused under it.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const current = live.current
      if (next === "active") {
        if (current.focused && current.launchMode != null) {
          dispatch({ type: "focus", playerMode: current.launchMode })
        }
        return
      }
      dispatch({
        type: "background",
        positionSeconds: clipPosition(current.state, current.activePlayer),
      })
    })
    return () => subscription.remove()
  }, [])

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

  const active = activeSlot(state)
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
      pendingRecords.current.push(recordEntry(motionClip))
    }
    // KTD22: record writes wait for the gesture. KTD15: at play, not preload.
    if (gestureActive) return
    const store = getClipRecordStore()
    for (const entry of pendingRecords.current.splice(0)) store.add(entry)
  }, [motionToken, motionClip, gestureActive])

  useEffect(() => {
    if (!state.demotedThisLaunch) return
    void getDemotionStore().write({
      demotedAtMs: Date.now(),
      appVersion: readAppVersion(),
    })
  }, [state.demotedThisLaunch])

  // ── Handlers ────────────────────────────────────────────────────────
  const handleMove = useCallback((move: ExplorePagerMove) => {
    dispatch({ type: move === "next" ? "swipeNext" : "swipePrevious" })
  }, [])
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
      dispatch({ type: "keepWatching", positionSeconds: position })
      openKeepWatching({
        clip,
        positionSeconds: position,
        navigate: (href) => router.navigate(href),
      })
    },
    [router],
  )

  // ── Render ──────────────────────────────────────────────────────────
  const views = mountedViews(state)
  const renderUnderlay = ({ pageStyle }: ExplorePagerUnderlay) =>
    views.map((player) => (
      <View
        key={player}
        testID={`explore-feed-view-${player}`}
        style={pageStyle(viewRole(state, player))}
      >
        <FeedVideoView player={players[player]} contentFit={CONTENT_FIT} />
      </View>
    ))

  const current = currentClip(state)
  const currentLayers =
    current == null ? null : (
      <>
        {veil.veilVisible && (
          <View
            testID="explore-clip-veil"
            style={styles.cover}
            pointerEvents="none"
          >
            {veil.image != null && (
              <Image
                source={veil.image.uri}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={veil.image.uri}
              />
            )}
          </View>
        )}
        {veil.spinnerVisible && <PlayerLoadingVeil />}
        {veil.failed && <ClipFailed />}
        <ClipOverlay
          clip={current}
          player={activePlayer}
          isCurrent
          muted={exploreMuted}
          paused={state.phase === "paused" && state.overlay == null}
          onToggleMute={handleToggleMute}
          onKeepWatching={handleKeepWatching}
          onOverlayOpen={handleOverlayOpen}
          onOverlayClose={handleOverlayClose}
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
          languageName={
            deriveLanguageDisplay(queue.feedLanguageSlug, null).name
          }
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
  children,
}: ClipPageProps) {
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

  // Opaque, so a player that still holds an old frame never shows through.
  if (clip == null) {
    return (
      <View
        testID="explore-page-cover"
        style={styles.cover}
        pointerEvents="none"
      />
    )
  }
  if (role !== "current") {
    if (!covered) return null
    const poster = clipPosterUri(clip)
    return (
      <View
        testID="explore-page-cover"
        style={styles.cover}
        pointerEvents="none"
      >
        {poster != null && (
          <Image
            source={poster}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={poster}
          />
        )}
      </View>
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
        {...accessibility}
      />
      {children}
    </>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BLACK },
  cover: { ...StyleSheet.absoluteFill, backgroundColor: BLACK },
})
