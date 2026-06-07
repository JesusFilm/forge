import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"
import { useEvent } from "expo"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { extractMuxPlaybackId } from "../../lib/muxThumbnail"
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
import { SubtitleOverlay } from "./SubtitleOverlay"

// Caption distance above the bottom edge (px). In fullscreen the caption lifts
// clear of the control bar while the chrome is visible and drops to the button
// row when it hides; inline it sits just above the button row.
const SUBTITLE_OFFSET_FS_CHROME_VISIBLE = 92
const SUBTITLE_OFFSET_FS_CHROME_HIDDEN = 12
const SUBTITLE_OFFSET_INLINE = 14

type VideoPlayerProps = {
  streamingUrl: string | null
  posterUrl: string | null
  subtitleVttSrc?: string | null
  onPlayingChange?: (isPlaying: boolean) => void
  /** True while the player is expanded to a custom in-tree fullscreen. The
   *  parent route owns the state (it also drives orientation/header/back). */
  fullscreen?: boolean
  /** Toggle fullscreen (fired by the fullscreen control). */
  onToggleFullscreen?: () => void
}

export function VideoPlayer({
  streamingUrl,
  posterUrl,
  subtitleVttSrc = null,
  onPlayingChange,
  fullscreen = false,
  onToggleFullscreen,
}: VideoPlayerProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()

  const [hasStarted, setHasStarted] = useState(false)
  const wasPlayingRef = useRef(false)
  const resolvedPoster = resolveImageUrl(posterUrl)
  const playerHeight = Math.round(screenWidth * (9 / 16))

  // The source passed to useVideoPlayer must be FROZEN. useVideoPlayer recreates
  // (and releases) the player whenever this value changes — its dependency is
  // JSON.stringify(source). Source swaps must go through replaceAsync on the
  // SAME player instead; a changing creation source would release the player
  // mid-replace (FunctionCallException) and strand a fresh, paused player on the
  // new asset — the "black screen, stuck on language switch" bug.
  const creationSource = useRef(streamingUrl).current
  const player = useVideoPlayer(creationSource, (p) => {
    p.muted = false
    p.loop = false
    // Favor a fast first frame on cellular over a deep prebuffer — JFP's
    // audience skews to low-bandwidth networks. (Android-only fields are
    // ignored on iOS.)
    p.bufferOptions = {
      minBufferForPlayback: 1,
      preferredForwardBufferDuration: 8,
      prioritizeTimeOverSizeThreshold: true,
    }
  })

  // The source currently loaded into the player, tracked separately from the
  // frozen creationSource so swap decisions can compare against it.
  const loadedUrlRef = useRef(streamingUrl)

  useEffect(() => {
    if (!streamingUrl || streamingUrl === loadedUrlRef.current) return

    // Decide swap vs no-swap by Mux playback ID, not raw URL string: the
    // optimistic seed URL is rebuilt from a playbackId while the resolved
    // variant carries the stored `hls`, so the same asset can have two
    // different URL strings. Reloading the same asset would needlessly
    // restart playback.
    const currentId = extractMuxPlaybackId(loadedUrlRef.current)
    const nextId = extractMuxPlaybackId(streamingUrl)
    loadedUrlRef.current = streamingUrl
    if (currentId != null && nextId != null && currentId === nextId) return

    // Preserve playback across the swap: replace() does not carry the playing
    // state to the new source, so a language switch mid-play would otherwise
    // strand a paused frame. Resume once the new source has loaded if we were
    // playing before.
    const wasPlaying = player.playing
    const resume = () => {
      if (!wasPlaying) return
      try {
        player.play()
      } catch {
        // Player already released.
      }
    }

    // replaceAsync loads off the main thread (replace() blocks the UI thread
    // for HLS on iOS). Fall back to the synchronous path if it rejects.
    void player
      .replaceAsync(streamingUrl)
      .then(resume)
      .catch(() => {
        try {
          player.replace(streamingUrl, true)
          resume()
        } catch {
          // Player already released.
        }
      })
  }, [streamingUrl, player])

  // Disable Mux's auto-generated subtitle tracks from the HLS manifest.
  // Admin CMS VTT subtitles are rendered by SubtitleOverlay instead.
  // AVPlayer can auto-select a track at source load, tracks-available, or a
  // device-locale match — these three signals cover every re-selection. (A
  // fourth statusChange listener was dropped: it fired on every buffer/seek
  // tick for the same effect the targeted events already cover.)
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

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  // Mirror isPlaying into a ref so the AppState listener can register once on
  // [player] and read the current value, instead of tearing down and
  // re-adding the subscription on every play/pause (which left a window where
  // a background event could be missed).
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    if (isPlaying && !hasStarted) setHasStarted(true)
    onPlayingChange?.(isPlaying)
  }, [isPlaying, hasStarted, onPlayingChange])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (wasPlayingRef.current) {
          try {
            player.play()
          } catch {
            // Already released
          }
        }
      } else {
        wasPlayingRef.current = isPlayingRef.current
        try {
          player.pause()
        } catch {
          // Already released
        }
      }
    })
    return () => subscription.remove()
  }, [player])

  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released
      }
    }
  }, [player])

  const controls = useControlsVisibility(player)

  // ── Tap disambiguation (U4) ─────────────────────────────────────────
  // Single tap toggles chrome (reveal is immediate on press-in so it never
  // lags, KTD3); a second tap within DOUBLE_TAP_MS seeks the tapped half ±10s
  // and shows a brief indicator independent of chrome visibility.
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
        if (singleTapAction(wasVisible) === "hide") controls.hide()
      }, DOUBLE_TAP_MS)
    },
    [controls, doSideSeek],
  )

  // Caption vertical offset:
  //  - Inline: FIXED on the button row (never moves; the timeline z-layers over
  //    it via the render order below).
  //  - Fullscreen: lifts above the control bar when the chrome is visible (so a
  //    tall 2-line caption never covers the timeline) and drops back to the
  //    button row when the chrome hides — animated (only in fullscreen).
  // Horizontal padding clears the mute/fullscreen icons (and the landscape
  // side-notch); the text enlarges in fullscreen where the video fills the screen.
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
    <View
      style={[
        styles.container,
        fullscreen
          ? {
              position: "absolute",
              top: 0,
              left: 0,
              width: screenWidth,
              height: screenHeight,
              zIndex: 1000,
            }
          : { height: playerHeight },
      ]}
    >
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="contain"
        allowsPictureInPicture
        // textureView composites in the RN view hierarchy on Android so the
        // controls/captions overlay reliably renders above the video surface
        // (SurfaceView otherwise punches through). No-op on iOS.
        surfaceType={Platform.OS === "android" ? "textureView" : undefined}
      />

      {!hasStarted && resolvedPoster != null && (
        <Image
          source={resolvedPoster}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey="watch-poster"
          accessibilityLabel="Video thumbnail"
        />
      )}

      {/* Full-bleed tap target behind the chrome. A tap on the video body
          toggles the controls (the controls layer is box-none and the
          subtitle overlay is pointerEvents none, so empty-area taps fall
          through to here); a double tap on a side seeks ±10s. */}
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
      {controls.mounted && (
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

      {/* Captions sit on the button row, ABOVE the scrim but BELOW the controls
          so the timeline always draws over a tall (2-line) caption and the
          progress stays visible. Kept outside the fade wrapper so they stay
          visible when the controls auto-hide. */}
      <SubtitleOverlay
        player={player}
        vttSrc={subtitleVttSrc}
        bottomOffset={subtitleBottomOffset}
        horizontalInset={subtitleHorizontalInset}
        fontSize={subtitleFontSize}
        animate={fullscreen}
      />

      {/* Chrome controls — fade with the chrome and layer OVER the subtitle, so
          the timeline/buttons are always on top of the captions (R: timeline
          must stay visible). */}
      {controls.mounted && (
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
  container: {
    width: "100%",
    backgroundColor: BLACK,
  },
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
    backgroundColor: "rgba(0, 0, 0, 0.55)",
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
