// Muted, non-interactive cinematic backdrop for the video-details screen.
//
// Uses a poster-hold → video-fade-in media layer (poster held until the
// stream is ready, then crossfade — no black flash). A single layer (one
// video, not a focus-driven crossfade between heroes) plus the
// overlay-visibility pause (R6): when the fullscreen overlay player is open,
// this preview pauses; it resumes on close.
//
// NON-INTERACTIVE (KTD4/KTD8): the VideoView is wrapped in a
// `pointerEvents="none"` View, marked `focusable={false}`, and the gradient/text
// layers use `collapsable={false}` on Android so the SurfaceView z-order
// punch-through doesn't swallow them. The backdrop holds zero focusables — the
// page's first focusable (the Play button) owns initial focus.

import { useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  StyleSheet,
  View,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"

import { COLORS, hexToRgba } from "../../lib/colors"
import { validateStreamingUrl } from "../../lib/validateUrl"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
const BACKDROP_HEIGHT = SCREEN_HEIGHT * 0.55

// Hold the poster over the (invisible) video for this long after the stream is
// ready, then crossfade the video in — gives the eye a stable still instead of
// a black-flash → pop.
const POSTER_HOLD_MS = 500
const POSTER_FADE_MS = 500

type VideoBackdropProps = {
  /** Active variant's HLS URL (validated by caller, re-validated here). */
  streamingUrl: string | null
  /** Cinematic still shown under the video / as the fallback when no stream. */
  posterUrl: string | null
  /**
   * True while the fullscreen overlay player is visible. The preview pauses
   * while open (R6) and resumes on close — only one of the two players should
   * be decoding at a time.
   */
  overlayVisible: boolean
}

export function VideoBackdrop({
  streamingUrl,
  posterUrl,
  overlayVisible,
}: VideoBackdropProps) {
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled)
    })
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    )
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [])

  const validStream =
    streamingUrl != null && validateStreamingUrl(streamingUrl)
      ? streamingUrl
      : null
  const hasValidStream = validStream !== null

  // Freeze the source passed to useVideoPlayer. Its source argument RELEASES and
  // recreates the player whenever it changes (black/stuck frame). A dub switch
  // from the Language panel mutates streamingUrl in place, so we seed the player
  // with the first source and route every later swap through replaceAsync on the
  // SAME instance — mirrors VideoPlayer.tsx's frozen-creationSource pattern.
  const creationSource = useRef(validStream).current
  const player = useVideoPlayer(creationSource, (p) => {
    p.muted = true
    p.loop = true
  })

  const loadedSourceRef = useRef(creationSource)
  useEffect(() => {
    if (validStream === loadedSourceRef.current) return
    loadedSourceRef.current = validStream
    // Swap on the same instance; null clears the source when no valid stream.
    player.replaceAsync(validStream).catch(() => {})
  }, [player, validStream])

  // Gate mounting the native VideoView until the source is ready to render its
  // first frame — avoids the black-flash window during HLS init.
  const [videoReady, setVideoReady] = useState(false)
  const videoOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!hasValidStream) {
      setVideoReady(false)
      return
    }
    if (player.status === "readyToPlay") setVideoReady(true)
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") setVideoReady(true)
      else if (status === "error" || status === "idle") setVideoReady(false)
    })
    return () => sub.remove()
  }, [player, hasValidStream])

  // Play unless the overlay is open. Pausing while the overlay plays keeps a
  // single decoder active and frees the backdrop's frame budget for the
  // fullscreen player (R6). Resume on close.
  useEffect(() => {
    if (!hasValidStream) return
    try {
      if (overlayVisible) player.pause()
      else player.play()
    } catch {
      // Native player already released; benign.
    }
  }, [player, hasValidStream, overlayVisible])

  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released; benign.
      }
    }
  }, [player])

  // Poster-hold → video-fade-in sequence once the video is ready.
  useEffect(() => {
    if (reduceMotion) {
      videoOpacity.setValue(videoReady ? 1 : 0)
      return
    }
    if (!videoReady) {
      videoOpacity.setValue(0)
      return
    }
    const anim = Animated.sequence([
      Animated.delay(POSTER_HOLD_MS),
      Animated.timing(videoOpacity, {
        toValue: 1,
        duration: POSTER_FADE_MS,
        useNativeDriver: true,
      }),
    ])
    anim.start()
    return () => anim.stop()
  }, [videoReady, reduceMotion, videoOpacity])

  return (
    <View style={styles.container} pointerEvents="none" collapsable={false}>
      {/* Base: poster (or solid surface fallback), always painted first. */}
      {posterUrl != null ? (
        <Image
          source={{ uri: posterUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={`backdrop-${posterUrl}`}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
      )}

      {/* Video — mounted only once ready, held invisible over the poster for
          POSTER_HOLD_MS then crossfaded in. Wrapped in pointerEvents="none"
          (KTD4) so it can never steal D-pad focus from the action row below. */}
      {hasValidStream && videoReady ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: videoOpacity }]}
          pointerEvents="none"
        >
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
            focusable={false}
          />
        </Animated.View>
      ) : null}

      {/* Gradient fade to the warm-stone surface. `collapsable={false}` forces a
          native view on Android TV so the gradient isn't folded under the
          VideoView SurfaceView. hexToRgba(_, 0) stops — never "transparent". */}
      <LinearGradient
        colors={[hexToRgba(COLORS.surface, 0), COLORS.surface]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        collapsable={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: BACKDROP_HEIGHT,
    position: "relative",
    overflow: "hidden",
  },
  fallbackBg: {
    backgroundColor: COLORS.surfaceContainer,
  },
})
