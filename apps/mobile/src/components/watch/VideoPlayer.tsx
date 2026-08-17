import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { reportDatadogAction } from "../../lib/datadog"
import { applySkip } from "../../lib/scrubber"
import {
  DOUBLE_TAP_MS,
  SKIP_SECONDS,
  classifyTap,
  seekDeltaForTap,
  seekSideForTap,
  singleTapAction,
  type SeekSide,
} from "../../lib/tapSeek"
import { useControlsVisibility } from "../../hooks/useControlsVisibility"
import { PlayerControls } from "./PlayerControls"
import { PlayerLoadingVeil } from "./PlayerLoadingVeil"
import { SubtitleOverlay } from "./SubtitleOverlay"

// Caption distance above the bottom edge (px). In fullscreen the caption lifts
// clear of the control bar while the chrome is visible and drops to the button
// row when it hides; inline it sits just above the button row.
const SUBTITLE_OFFSET_FS_CHROME_VISIBLE = 92
const SUBTITLE_OFFSET_FS_CHROME_HIDDEN = 12
const SUBTITLE_OFFSET_INLINE = 14

// How long the pre-autostart veil may hold before it gives the chrome back.
const AUTOSTART_VEIL_TIMEOUT_MS = 12000

type VideoPlayerProps = {
  /** The root-owned player (KD2). This component creates none: exactly one
   *  adapter instance exists app-wide, in `PlaybackHost`. */
  player: ExpoVideoPlayer
  isPlaying: boolean
  /** Published by the host from the player's own status (R22), so the full
   *  view and the floating window read one failure state. */
  loadFailed?: boolean
  streamingUrl: string | null
  posterUrl: string | null
  subtitleVttSrc?: string | null
  onPlayingChange?: (isPlaying: boolean) => void
  /** True while the player is expanded to a custom in-tree fullscreen. The
   *  parent route owns the state (it also drives orientation/header/back). */
  fullscreen?: boolean
  /** Toggle fullscreen (fired by the fullscreen control). */
  onToggleFullscreen?: () => void
  /** Resume-eligible position (KTD6). When set, the player seeks here by
   *  itself once the source loads — no Resume button. */
  resumeAtSeconds?: number | null
  /** Start playing once the source is ready, without a tap. Opt-in per call
   *  site: this player also backs the series-detail trailer dock, so an
   *  implicit default would autoplay surfaces that never asked for it. */
  autostart?: boolean
}

/**
 * The full-screen player CHROME (U6). It fills the frame the playback host
 * draws its one video view into, and layers over that view exactly as it
 * layered over its own before the hoist: poster, veil, tap target, scrim,
 * captions, controls.
 */
export function VideoPlayer({
  player,
  isPlaying,
  loadFailed = false,
  streamingUrl,
  posterUrl,
  subtitleVttSrc = null,
  onPlayingChange,
  fullscreen = false,
  onToggleFullscreen,
  resumeAtSeconds = null,
  autostart = false,
}: VideoPlayerProps) {
  // Seeded from the live player: expanding back onto a playing video remounts
  // this chrome, and the effect that clears a bare `false` runs after paint —
  // one frame of autostart veil over a video already playing.
  const [hasStarted, setHasStarted] = useState(() => {
    try {
      return player.playing
    } catch {
      return false // Native player already released
    }
  })
  const resolvedPoster = resolveImageUrl(posterUrl)

  useEffect(() => {
    if (isPlaying && !hasStarted) setHasStarted(true)
    onPlayingChange?.(isPlaying)
  }, [isPlaying, hasStarted, onPlayingChange])

  // Releases the pre-autostart suppression below for a load that neither starts
  // nor errors (the host's `loadFailed` covers one that errors). Without both, a
  // viewer whose playback never starts is stranded on a spinner with no controls.
  const [loadTimedOut, setLoadTimedOut] = useState(false)

  useEffect(() => {
    setLoadTimedOut(false)
  }, [player, streamingUrl])

  // An autostarting player opens on its poster, not on transport chrome: a play
  // button and a 0:00 scrubber for a video about to start itself reads as
  // broken. Suppress chrome until the first frame plays. `hasStarted` never
  // resets, so this covers the initial load only — a later language swap keeps
  // the chrome it already had.
  const awaitingAutostart =
    autostart &&
    !hasStarted &&
    streamingUrl != null &&
    !loadFailed &&
    !loadTimedOut

  // Backstop for a load that neither starts nor errors. Releasing early only
  // reveals chrome sooner, so a false positive on a slow network is harmless —
  // being stuck with no controls is not.
  useEffect(() => {
    if (!awaitingAutostart) return
    const t = setTimeout(() => setLoadTimedOut(true), AUTOSTART_VEIL_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [awaitingAutostart])

  const controls = useControlsVisibility(player)

  // Tap disambiguation (U4): single tap toggles chrome (revealed on press-in
  // so it never lags, KTD3); second tap within DOUBLE_TAP_MS seeks the tapped
  // half ±10s with a brief indicator, independent of chrome visibility.
  const tapWidthRef = useRef(0)
  const wasVisibleRef = useRef(true)
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [seekFlash, setSeekFlash] = useState<{
    side: SeekSide
    delta: number
  } | null>(null)
  // A monotonically-bumped signal so PlayerControls can reflect a double-tap
  // seek in its time label/scrubber immediately — even while paused, when its
  // own 500ms poll is idle.
  const [seekSignal, setSeekSignal] = useState<{
    time: number
    n: number
  } | null>(null)
  const seekNonceRef = useRef(0)

  // Play and seek latch SEPARATELY: resumeAtSeconds hydrates async and can
  // arrive after the source loads, so one shared latch would forfeit the
  // seek and let playback from 0 overwrite the saved position.
  const autoPlayedRef = useRef(false)
  const resumeSeekedRef = useRef(false)
  // Gates the foreground retry below: retrying before the source has loaded
  // would call play() on an item that is not ready.
  const sourceLoadedRef = useRef(false)
  useEffect(() => {
    autoPlayedRef.current = false
    resumeSeekedRef.current = false
    sourceLoadedRef.current = false
  }, [streamingUrl])
  useEffect(() => {
    if (!autostart) return

    const applySeek = () => {
      if (resumeSeekedRef.current || resumeAtSeconds == null) return
      try {
        player.currentTime = resumeAtSeconds
      } catch {
        return // Released mid-seek; leave unlatched so a later pass retries.
      }
      resumeSeekedRef.current = true
      // The scrubber polls at 500ms and is idle until playback reports in,
      // so signal it or the restored position reads 0:00 for a beat.
      seekNonceRef.current += 1
      setSeekSignal({ time: resumeAtSeconds, n: seekNonceRef.current })
    }

    const applyPlay = () => {
      if (autoPlayedRef.current) return
      // Never start audio the viewer cannot see. The adapter owns AppState
      // resume and has no way to observe or undo a play issued from here
      // while backgrounded.
      if (AppState.currentState !== "active") return
      try {
        player.play()
      } catch {
        return // Released; leave unlatched so a later load can still start.
      }
      autoPlayedRef.current = true
      // Reported only once playback actually started, so the adoption metric
      // cannot count a released player as a successful autostart.
      reportDatadogAction("autostart_applied", {
        resumed: resumeSeekedRef.current,
      })
    }

    const onSourceLoad = () => {
      sourceLoadedRef.current = true
      applySeek()
      applyPlay()
    }
    const sub = player.addListener("sourceLoad", onSourceLoad)
    // applyPlay bails without latching while backgrounded, sourceLoad fires
    // once per source, and the adapter's foreground resume only replays a
    // video that was ALREADY playing — so nothing else retries this. Without
    // the retry, backgrounding through the load window leaves the veil up for
    // good.
    const appSub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || !sourceLoadedRef.current) return
      applySeek()
      applyPlay()
    })
    // A resume position can hydrate after the source already loaded — seek
    // then, rather than losing it. Guarded on having played so this never
    // fires against a previous, still-loaded source mid-swap.
    if (autoPlayedRef.current) applySeek()
    return () => {
      sub.remove()
      appSub.remove()
    }
  }, [player, resumeAtSeconds, streamingUrl, autostart])

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const showSeekFlash = useCallback((side: SeekSide, delta: number) => {
    setSeekFlash({ side, delta })
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setSeekFlash(null), 600)
  }, [])

  const doSideSeek = useCallback(
    (locationX: number) => {
      const delta = seekDeltaForTap(
        locationX,
        tapWidthRef.current,
        SKIP_SECONDS,
      )
      if (delta === 0) return
      const target = applySkip(player.currentTime, delta, player.duration)
      if (target == null) return
      player.currentTime = target
      seekNonceRef.current += 1
      setSeekSignal({ time: target, n: seekNonceRef.current })
      const side = seekSideForTap(locationX, tapWidthRef.current)
      if (side) showSeekFlash(side, delta)
    },
    [player, showSeekFlash],
  )

  const handleTapPressIn = useCallback(() => {
    // Read ground-truth visibility (the ref), NOT controls.controlsVisible —
    // the render state lags by one fade, so mid-auto-hide it still reads true
    // and the pending single-tap would hide the chrome this press just revealed.
    wasVisibleRef.current = controls.isVisibleNow()
    controls.revealIfHidden()
  }, [controls])

  const handleTapPress = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX } = e.nativeEvent
      if (classifyTap(singleTapTimerRef.current != null) === "double") {
        // Second tap within the window → seek. Cancel the pending single-tap
        // FIRST, else the stale timer fires after the seek and hides chrome.
        if (singleTapTimerRef.current != null) {
          clearTimeout(singleTapTimerRef.current)
          singleTapTimerRef.current = null
        }
        doSideSeek(locationX)
        return
      }
      const wasVisible = wasVisibleRef.current
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null
        // Single tap resolved: hide only if chrome was already up; if it was
        // hidden it was just revealed on press-in, so leave it visible (R3).
        // Skipped while the veil is up: the chrome is unmounted, so this would
        // hide something invisible and playback would then start with no
        // controls until the viewer taps again.
        if (awaitingAutostart) return
        if (singleTapAction(wasVisible) === "hide") controls.hide()
      }, DOUBLE_TAP_MS)
    },
    [awaitingAutostart, controls, doSideSeek],
  )

  // Caption offset: inline = fixed on the button row; fullscreen = lifts above
  // the control bar while chrome shows (so a 2-line caption never covers the
  // timeline) and drops back when it hides (animated). Padding clears the icons.
  const insets = useSafeAreaInsets()
  const subtitleBottomOffset = fullscreen
    ? controls.controlsVisible
      ? SUBTITLE_OFFSET_FS_CHROME_VISIBLE
      : SUBTITLE_OFFSET_FS_CHROME_HIDDEN
    : SUBTITLE_OFFSET_INLINE
  const subtitleHorizontalInset = fullscreen
    ? Math.max(insets.left, insets.right, 56)
    : 56
  const subtitleFontSize = fullscreen ? 22 : 16

  return (
    // absoluteFill, not a sized box: the host's frame owns the geometry (KTD17)
    // and paints the letterbox black behind the video view this chrome covers.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {!hasStarted && resolvedPoster != null && (
        <Image
          source={resolvedPoster}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey="watch-poster"
          accessibilityLabel="Video thumbnail"
        />
      )}

      {awaitingAutostart && <PlayerLoadingVeil />}

      {/* Full-bleed tap target behind the chrome (controls layer is box-none,
          subtitle overlay is pointerEvents none, so empty-area taps fall here).
          Tap toggles controls; double tap on a side seeks ±10s. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onLayout={(e: LayoutChangeEvent) => {
          tapWidthRef.current = e.nativeEvent.layout.width
        }}
        onPressIn={handleTapPressIn}
        onPress={handleTapPress}
        accessibilityRole="button"
        accessibilityLabel="Toggle player controls"
      />

      {seekFlash != null && (
        <View
          pointerEvents="none"
          style={[
            styles.seekFlash,
            seekFlash.side === "left"
              ? styles.seekFlashLeft
              : styles.seekFlashRight,
          ]}
        >
          <Ionicons
            name={seekFlash.delta < 0 ? "play-back" : "play-forward"}
            size={22}
            color={TEXT_ON_OVERLAY}
          />
          <Text style={styles.seekFlashText}>{Math.abs(seekFlash.delta)}s</Text>
        </View>
      )}

      {/* Chrome scrim — fades with the chrome and sits BELOW the subtitle so it
          never dims the caption. */}
      {controls.mounted && !awaitingAutostart && (
        <Animated.View
          pointerEvents="none"
          style={[styles.chromeScrim, { opacity: controls.opacityAnim }]}
        >
          <LinearGradient
            colors={[
              hexToRgba(BLACK, 0),
              hexToRgba(BLACK, 0.2),
              hexToRgba(BLACK, 0.7),
            ]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}

      {/* Captions sit ABOVE the scrim but BELOW the controls so the timeline
          always draws over a tall caption. Outside the fade wrapper so they
          stay visible when the controls auto-hide. Gated on hasStarted: captions
          stay hidden until the first play (a cue covering t=0 would otherwise
          paint over the un-started poster), then persist through pauses. */}
      <SubtitleOverlay
        player={player}
        vttSrc={hasStarted ? subtitleVttSrc : null}
        bottomOffset={subtitleBottomOffset}
        horizontalInset={subtitleHorizontalInset}
        fontSize={subtitleFontSize}
        animate={fullscreen}
      />

      {/* Chrome controls — fade with the chrome and layer OVER the subtitle, so
          the timeline/buttons are always on top of the captions (R: timeline
          must stay visible). */}
      {controls.mounted && !awaitingAutostart && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: controls.opacityAnim }]}
          pointerEvents="box-none"
        >
          <PlayerControls
            player={player}
            fullscreen={fullscreen}
            onFullscreen={onToggleFullscreen}
            onInteract={controls.noteInteraction}
            seekSignal={seekSignal}
          />
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  chromeScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  seekFlash: {
    position: "absolute",
    top: "50%",
    marginTop: -28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: hexToRgba(BLACK, 0.55),
  },
  seekFlashLeft: {
    left: "14%",
  },
  seekFlashRight: {
    right: "14%",
  },
  seekFlashText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
})
