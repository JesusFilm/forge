/**
 * The floating mini player window (U7).
 *
 * It BORROWS the host's player and it owns the host's ONE video surface while
 * the viewer is off the watch route: the keep-alive slot and the visible window
 * are the same logical slot, rendered from one root element so the surface
 * reconciles in place across a suppression instead of unmounting and
 * re-attaching. On the watch route it mounts nothing — that screen still owns
 * its own player and its own surface until the route borrow lands.
 *
 * It imports no router (KTD11) and no gesture library (KTD5): the caller
 * injects navigate, dismiss and play-pause, and the drag is `PanResponder`
 * plus `Animated.ValueXY`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type PanResponderInstance,
} from "react-native"
import { VideoView } from "expo-video"
import Ionicons from "@expo/vector-icons/Ionicons"
import type { VideoPlayer } from "expo-video"

import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import {
  CONTROL_SPACING,
  DEFAULT_CORNER,
  MIN_TOUCH_TARGET,
  allowedCorners,
  cornerOrigin,
  miniPlayerSize,
  snapCorner,
  type Chrome,
  type Corner,
  type Point,
  type Size,
} from "../../lib/miniPlayer/layout"
import {
  windowHoldsSurface,
  type MiniPlayerPresentation,
} from "../../lib/miniPlayer/presentation"
import { resolveImageUrl } from "../../lib/resolveImageUrl"

/** The floating window itself. */
export const MINI_PLAYER_WINDOW_SLOT = "mini-player-window-slot"
/** The same surface while the window is suppressed. */
export const MINI_PLAYER_KEEPALIVE_SLOT = "mini-player-keepalive-slot"
export const MINI_PLAYER_EXPAND_TARGET = "mini-player-expand-target"
/** The fading layer. It carries the opacity, so R18's fade is read from here. */
export const MINI_PLAYER_POSTER = "mini-player-poster"
export const MINI_PLAYER_POSTER_IMAGE = "mini-player-poster-image"
/** The opaque rectangle that stands in when the video has no poster art. */
export const MINI_PLAYER_POSTER_FALLBACK = "mini-player-poster-fallback"
export const MINI_PLAYER_POSITION_INDICATOR = "mini-player-position-indicator"
export const MINI_PLAYER_POSITION_FILL = "mini-player-position-fill"

/**
 * The ONE gate on the chrome and the tap-to-expand target, released by the
 * surface's first frame, by a stream failure, or unconditionally by
 * this timer. "Started OR errored" misses "neither", which strands the viewer
 * with no controls and no way out.
 */
export const MINI_PLAYER_REVEAL_RELEASE_MS = 1200
export const MINI_PLAYER_POSTER_FADE_MS = 220

export const MINI_PLAYER_ACTION_PLAY_PAUSE = "miniPlayerPlayPause"
export const MINI_PLAYER_ACTION_DISMISS = "miniPlayerDismiss"
export const MINI_PLAYER_ACTION_MOVE = "miniPlayerMoveToCorner"

export const PLAY_LABEL = "Play"
export const PAUSE_LABEL = "Pause"
export const DISMISS_LABEL = "Close mini player"
export const MOVE_LABEL = "Move to the next corner"
export const FAILURE_LABEL = "Video unavailable"

const SNAP_MS = 180
/** Movement that turns a touch into a drag rather than a tap. */
const DRAG_CLAIM_PX = 4
const CONTROL_ICON = 20

/** What the window shows about the video the session is playing. */
export type MiniPlayerWindowVideo = {
  videoId?: string
  videoSlug?: string
  title?: string | null
  posterUrl?: string | null
  positionSeconds: number
  durationSeconds: number
}

export type MiniPlayerWindowProps = {
  /** Which surface hosts the player, straight from `presentationFor`. */
  presentation: MiniPlayerPresentation
  player: VideoPlayer
  video: MiniPlayerWindowVideo
  /** The host's live playing flag. Read only as the fallback seed below. */
  isPlaying: boolean
  /** Live screen size, read by the host so this component stays testable. */
  screen: Size
  /** Live top and bottom chrome the window insets inside (R7). */
  chrome: Chrome
  onExpand: (video: MiniPlayerWindowVideo) => void
  onDismiss: () => void
  onPlayPause: () => void
  /** Playback reached its end (R21). */
  onEnded?: () => void
  /** The stream failed (R22). Fires again if it fails after a recovery. */
  onFailure?: () => void
}

let posterImage: typeof import("expo-image").Image | null = null

/**
 * Deferred so expo-image stays out of the cold-launch module graph. The require
 * is synchronous, so R18's poster is still opaque at the window's first commit.
 */
function loadPosterImage(): typeof import("expo-image").Image {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  posterImage ??= (require("expo-image") as typeof import("expo-image")).Image
  return posterImage
}

function readPlaying(player: VideoPlayer, fallback: boolean): boolean {
  try {
    return player.playing
  } catch {
    return fallback
  }
}

function readErrored(player: VideoPlayer): boolean {
  try {
    return player.status === "error"
  } catch {
    return false
  }
}

/** 0..100 for the indicator fill; a duration of zero reads as no progress. */
function progressPercent(positionSeconds: number, duration: number): number {
  if (!(duration > 0)) return 0
  return Math.max(0, Math.min(100, (positionSeconds / duration) * 100))
}

export function MiniPlayerWindow({
  presentation,
  player,
  video,
  isPlaying,
  screen,
  chrome,
  onExpand,
  onDismiss,
  onPlayPause,
  onEnded,
  onFailure,
}: MiniPlayerWindowProps) {
  const floating = presentation === "floating"
  const size = useMemo(() => miniPlayerSize(screen.width), [screen.width])

  const [corner, setCorner] = useState<Corner>(() => {
    const allowed = allowedCorners(screen, size, chrome)
    return allowed.includes(DEFAULT_CORNER) ? DEFAULT_CORNER : allowed[0]
  })
  // Lazily seeded at the corner it opens in, so the effect below animates from
  // the right place instead of sliding in from the origin on the first frame.
  const positionRef = useRef<Animated.ValueXY | null>(null)
  if (positionRef.current == null) {
    positionRef.current = new Animated.ValueXY(
      cornerOrigin(corner, screen, size, chrome),
    )
  }
  const position = positionRef.current
  // The committed origin. The pan handler reads this rather than the animated
  // value, so production code never reaches Animated's private getter.
  const originRef = useRef<Point>(cornerOrigin(corner, screen, size, chrome))
  const dragStartRef = useRef<Point>(originRef.current)

  const { width: screenWidth, height: screenHeight } = screen
  const {
    top: chromeTop,
    bottom: chromeBottom,
    left: chromeLeft,
    right: chromeRight,
  } = chrome

  const geometry = useMemo(
    () => ({
      screen: { width: screenWidth, height: screenHeight },
      chrome: {
        top: chromeTop,
        bottom: chromeBottom,
        left: chromeLeft,
        right: chromeRight,
      },
    }),
    [
      screenWidth,
      screenHeight,
      chromeTop,
      chromeBottom,
      chromeLeft,
      chromeRight,
    ],
  )

  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  const sizeRef = useRef(size)
  sizeRef.current = size
  const cornerRef = useRef(corner)
  cornerRef.current = corner

  // Geometry only, never the corner: a rotation or a tab bar appearing can take
  // the clearance out of the corner the window is in, and that reposition is
  // instant. A corner the viewer chose animates instead — see commitCorner.
  useEffect(() => {
    const allowed = allowedCorners(geometry.screen, size, geometry.chrome)
    const next = allowed.includes(cornerRef.current)
      ? cornerRef.current
      : allowed[0]
    const origin = cornerOrigin(next, geometry.screen, size, geometry.chrome)
    originRef.current = origin
    if (next !== cornerRef.current) setCorner(next)
    position.setValue(origin)
  }, [geometry, size, position])

  const commitCorner = useCallback(
    (next: Corner) => {
      const origin = cornerOrigin(
        next,
        geometryRef.current.screen,
        sizeRef.current,
        geometryRef.current.chrome,
      )
      originRef.current = origin
      cornerRef.current = next
      setCorner(next)
      // JS-driven, matching the scrubber precedent (KTD5). The drag writes the
      // same value with setValue, and the two must share one driver.
      Animated.timing(position, {
        toValue: origin,
        duration: SNAP_MS,
        useNativeDriver: false,
      }).start()
    },
    [position],
  )

  const commitRef = useRef(commitCorner)
  commitRef.current = commitCorner

  // Lazy, not `useRef(PanResponder.create(...))`: that form builds a responder
  // on EVERY render and throws it away, at the one-second position cadence for
  // the whole life of a session.
  const panRef = useRef<PanResponderInstance | null>(null)
  if (panRef.current == null) {
    panRef.current = PanResponder.create({
      // A tap belongs to the controls and to the expand target underneath, so
      // the window claims movement only.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) =>
        Math.abs(gesture.dx) > DRAG_CLAIM_PX ||
        Math.abs(gesture.dy) > DRAG_CLAIM_PX,
      onMoveShouldSetPanResponderCapture: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) =>
        Math.abs(gesture.dx) > DRAG_CLAIM_PX ||
        Math.abs(gesture.dy) > DRAG_CLAIM_PX,
      onPanResponderGrant: () => {
        dragStartRef.current = originRef.current
      },
      onPanResponderMove: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => {
        // setValue, never Animated.event: with the native driver that form
        // fails silently under PanResponder and freezes the window (KTD5).
        position.setValue({
          x: dragStartRef.current.x + gesture.dx,
          y: dragStartRef.current.y + gesture.dy,
        })
      },
      onPanResponderRelease: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => {
        const release = {
          x: dragStartRef.current.x + gesture.dx,
          y: dragStartRef.current.y + gesture.dy,
        }
        commitRef.current(
          snapCorner(
            release,
            geometryRef.current.screen,
            sizeRef.current,
            geometryRef.current.chrome,
          ),
        )
      },
      onPanResponderTerminate: () => {
        // Back to where it was. `cornerRef`, not the closure: this responder is
        // built once, so a captured `corner` would be the opening one forever.
        commitRef.current(cornerRef.current)
      },
    })
  }
  const pan = panRef.current

  const [playing, setPlaying] = useState(() => readPlaying(player, isPlaying))
  const [failed, setFailed] = useState(() => readErrored(player))
  const [ended, setEnded] = useState(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const subscriptions = [
      player.addListener("playingChange", (payload: { isPlaying: boolean }) => {
        setPlaying(payload.isPlaying)
      }),
      // Followed in BOTH directions, like the full-screen surface: a latch
      // would keep the failure label up for the rest of the session after a
      // source swap recovered the player.
      player.addListener("statusChange", (payload: { status: string }) => {
        setFailed(payload.status === "error")
      }),
      player.addListener("playToEnd", () => setEnded(true)),
    ]
    return () => {
      for (const subscription of subscriptions) {
        try {
          subscription.remove()
        } catch {
          // Player already released.
        }
      }
    }
  }, [player])

  // Re-seeded per player: a listener alone never sees a source that already
  // failed before this effect ran.
  // Re-seeded per player: a listener alone never sees a source that already
  // failed before this effect ran.
  useEffect(() => {
    setFailed(readErrored(player))
  }, [player])

  useEffect(() => {
    if (failed) onFailure?.()
  }, [failed, onFailure])

  useEffect(() => {
    if (ended) onEnded?.()
  }, [ended, onEnded])

  useEffect(() => {
    // Unconditional, and the reason this gate cannot strand anyone: a surface
    // that never paints and never errors would otherwise hide dismiss forever.
    const timer = setTimeout(
      () => setRevealed(true),
      MINI_PLAYER_REVEAL_RELEASE_MS,
    )
    return () => clearTimeout(timer)
  }, [])

  /** The ONE gate. The chrome and the tap target read this same value. */
  const released = revealed || failed

  // R18: the poster covers the window from mount, and it comes back over a
  // dead or finished surface. The Android spike proved it paints there.
  const posterVisible = !released || failed || ended
  // Lazy for the same reason as the responder above: the argument to useRef is
  // evaluated on every render and discarded.
  const posterOpacityRef = useRef<Animated.Value | null>(null)
  if (posterOpacityRef.current == null) {
    posterOpacityRef.current = new Animated.Value(1)
  }
  const posterOpacity = posterOpacityRef.current
  const [posterMounted, setPosterMounted] = useState(true)

  useEffect(() => {
    if (posterVisible) {
      posterOpacity.setValue(1)
      setPosterMounted(true)
      return
    }
    const anim = Animated.timing(posterOpacity, {
      toValue: 0,
      duration: MINI_PLAYER_POSTER_FADE_MS,
      useNativeDriver: false,
    })
    // No `finished` guard: `stop()` fires this callback too, but it only runs
    // from the cleanup, and the setup that follows re-mounts the poster.
    anim.start(() => setPosterMounted(false))
    return () => anim.stop()
  }, [posterVisible, posterOpacity])

  const handlePlayPause = useCallback(() => {
    // Optimistic: the label must answer the tap now. The player's own
    // playingChange corrects it if the transport disagrees.
    setPlaying((previous) => !previous)
    onPlayPause()
  }, [onPlayPause])

  const handleExpand = useCallback(() => onExpand(video), [onExpand, video])

  const handleMoveToCorner = useCallback(() => {
    const allowed = allowedCorners(
      geometryRef.current.screen,
      sizeRef.current,
      geometryRef.current.chrome,
    )
    const index = allowed.indexOf(cornerRef.current)
    commitRef.current(allowed[(index + 1) % allowed.length])
  }, [])

  const title = video.title ?? "Video"
  const resolvedPoster = resolveImageUrl(video.posterUrl)
  const percent = progressPercent(video.positionSeconds, video.durationSeconds)
  const playPauseLabel = playing ? PAUSE_LABEL : PLAY_LABEL

  const actions = useMemo(
    () => [
      { name: MINI_PLAYER_ACTION_PLAY_PAUSE, label: playPauseLabel },
      { name: MINI_PLAYER_ACTION_DISMISS, label: DISMISS_LABEL },
      { name: MINI_PLAYER_ACTION_MOVE, label: MOVE_LABEL },
    ],
    [playPauseLabel],
  )

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      switch (event.nativeEvent.actionName) {
        case MINI_PLAYER_ACTION_PLAY_PAUSE:
          handlePlayPause()
          return
        case MINI_PLAYER_ACTION_DISMISS:
          onDismiss()
          return
        case MINI_PLAYER_ACTION_MOVE:
          handleMoveToCorner()
          return
        default:
          // An action this window never declared must do nothing. Expanding
          // here navigates the viewer away on a name nobody asked for.
          return
      }
    },
    [handlePlayPause, onDismiss, handleMoveToCorner],
  )

  // `full` mounts nothing: the watch route owns the one surface there. The
  // host publishes `surfaceFree` off this same predicate, so a claimant never
  // borrows into a commit where this window still holds a view.
  if (!windowHoldsSurface(presentation)) return null

  // Failure does NOT drop the view. R22 keeps that session alive, and a player
  // that plays surfaceless is permanently video-dead on Android — a recovered
  // stream would come back to a black rectangle. The poster covers it.
  const surfaceMounted = !ended
  const PosterImage =
    floating && posterMounted && resolvedPoster != null
      ? loadPosterImage()
      : null

  return (
    <Animated.View
      testID={floating ? MINI_PLAYER_WINDOW_SLOT : MINI_PLAYER_KEEPALIVE_SLOT}
      style={
        floating
          ? [
              styles.window,
              {
                width: size.width,
                height: size.height,
                transform: [
                  { translateX: position.x },
                  { translateY: position.y },
                ],
              },
            ]
          : styles.keepAlive
      }
      // On the CONTAINER, never on the video view. The suppressed slot takes no
      // touches; the floating one routes them to its own children.
      pointerEvents={floating ? "box-none" : "none"}
      // No accessibilityViewIsModal and no accessibilityElementsHidden on the
      // app behind: R8 forbids trapping focus.
      accessible={floating ? true : undefined}
      accessibilityRole={floating ? "button" : undefined}
      accessibilityLabel={floating ? `Mini player: ${title}` : undefined}
      accessibilityActions={floating ? actions : undefined}
      onAccessibilityAction={floating ? handleAccessibilityAction : undefined}
      {...(floating ? pan.panHandlers : null)}
    >
      {surfaceMounted && (
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
          onFirstFrameRender={() => setRevealed(true)}
        />
      )}

      {floating && posterMounted && (
        <Animated.View
          testID={MINI_PLAYER_POSTER}
          style={[StyleSheet.absoluteFill, { opacity: posterOpacity }]}
          pointerEvents="none"
        >
          {PosterImage != null ? (
            <PosterImage
              testID={MINI_PLAYER_POSTER_IMAGE}
              source={resolvedPoster}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey="mini-player-poster"
            />
          ) : (
            // Its own testID: sharing one with the image above made a poster
            // that resolved to nothing indistinguishable from one that loaded.
            <View
              testID={MINI_PLAYER_POSTER_FALLBACK}
              style={[StyleSheet.absoluteFill, styles.posterFallback]}
            />
          )}
        </Animated.View>
      )}

      {floating && released && (
        <>
          <Pressable
            testID={MINI_PLAYER_EXPAND_TARGET}
            style={StyleSheet.absoluteFill}
            onPress={handleExpand}
            // The root owns this window's accessibility; a second element here
            // would read the same thing twice.
            accessible={false}
            importantForAccessibility="no"
          />

          {failed && (
            <View style={styles.failure} pointerEvents="none">
              <Text style={styles.failureText}>{FAILURE_LABEL}</Text>
            </View>
          )}

          <View style={styles.controls} pointerEvents="box-none">
            <Pressable
              style={styles.control}
              onPress={handlePlayPause}
              accessibilityRole="button"
              accessibilityLabel={playPauseLabel}
            >
              <Ionicons
                name={playing ? "pause" : "play"}
                size={CONTROL_ICON}
                color={TEXT_ON_OVERLAY}
              />
            </Pressable>
            <Pressable
              style={styles.control}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={DISMISS_LABEL}
            >
              <Ionicons
                name="close"
                size={CONTROL_ICON}
                color={TEXT_ON_OVERLAY}
              />
            </Pressable>
          </View>

          <View
            testID={MINI_PLAYER_POSITION_INDICATOR}
            style={styles.indicatorTrack}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View
              testID={MINI_PLAYER_POSITION_FILL}
              style={[styles.indicatorFill, { width: `${percent}%` }]}
            />
          </View>
        </>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  window: {
    position: "absolute",
    top: 0,
    left: 0,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: BLACK,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  // 1x1 and fully transparent, not 0x0: a zero-size view can be laid out
  // without ever creating the native surface, which is the exact state the
  // keep-alive mount exists to prevent.
  keepAlive: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  posterFallback: {
    backgroundColor: BLACK,
  },
  controls: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: CONTROL_SPACING,
  },
  control: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: MIN_TOUCH_TARGET / 2,
    backgroundColor: hexToRgba(BLACK, 0.55),
  },
  failure: {
    position: "absolute",
    top: CONTROL_SPACING,
    left: CONTROL_SPACING,
    right: CONTROL_SPACING,
    alignItems: "center",
  },
  failureText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 11,
    fontWeight: "600",
  },
  indicatorTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: hexToRgba(TEXT_ON_OVERLAY, 0.3),
  },
  indicatorFill: {
    height: "100%",
    backgroundColor: TEXT_ON_OVERLAY,
  },
})
