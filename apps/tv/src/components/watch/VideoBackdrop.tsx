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
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"

import { COLORS, hexToRgba } from "../../lib/colors"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { WATCH_THEME, HERO_BOTTOM_FADE_HEIGHT } from "./watchDetailTheme"

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
  /**
   * When set, paints a bottom-edge fade to this color (e.g. WATCH_THEME.below)
   * so the hero blends into the section below it. Rendered as the LAST layer
   * with collapsable={false} so it composites OVER the Android VideoView
   * SurfaceView (a regular sibling view in the parent would be punched through —
   * see apps/tv/CLAUDE.md "Android TV VideoView z-order"). Anchored to the
   * backdrop's own bottom, so the backdrop must be sized to the visible hero.
   */
  bottomFadeColor?: string | null
}

export function VideoBackdrop({
  streamingUrl,
  posterUrl,
  overlayVisible,
  bottomFadeColor,
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
    // Looped manually via the playToEnd listener below — the native `loop` left a
    // long black pause before restarting (it re-buffers the HLS seek). With the
    // VideoView kept mounted (videoReady latches), replay() restarts instantly.
    p.loop = false
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
  // Mirrors overlayVisible for the playToEnd listener (reads it at call time
  // without re-registering the listener on every overlay toggle).
  const overlayVisibleRef = useRef(overlayVisible)

  useEffect(() => {
    if (!hasValidStream) {
      setVideoReady(false)
      return
    }
    if (player.status === "readyToPlay") setVideoReady(true)
    const sub = player.addListener("statusChange", ({ status }) => {
      // Latch true once ready and KEEP it through `idle`: a transient idle blip
      // while the video loops must not unmount the VideoView — remounting
      // re-initialises HLS from scratch, which (plus the poster-hold → fade
      // re-run) was the long black pause at the loop point.
      if (status === "readyToPlay") setVideoReady(true)
      // A genuine `error` is never a loop-seam blip — fall back to the poster so
      // a permanent failure (expired HLS token, CDN outage, decode error) doesn't
      // strand the hero on a frozen frame. `idle` is deliberately NOT reset.
      else if (status === "error") setVideoReady(false)
    })
    return () => sub.remove()
  }, [player, hasValidStream])

  // Immediate loop: the moment playback reaches the end, seek to the start and
  // play again. Driving this ourselves (loop=false above) restarts instantly —
  // the player stays mounted, so replay() is a fast in-player seek, not a full
  // HLS re-init. Only fires while playing, so it naturally respects the
  // overlay-pause (a paused backdrop never reaches the end).
  useEffect(() => {
    if (!hasValidStream) return
    const sub = player.addListener("playToEnd", () => {
      // Guard the overlay-pause race: if the fullscreen player opened right at
      // the loop seam, a queued playToEnd must not resume the backdrop (two
      // concurrent decoders — R6). The overlay-pause effect already paused us.
      if (overlayVisibleRef.current) return
      try {
        player.replay()
      } catch {
        // Native player already released; benign.
      }
    })
    return () => sub.remove()
  }, [player, hasValidStream])

  // Play unless the overlay is open. Pausing while the overlay plays keeps a
  // single decoder active and frees the backdrop's frame budget for the
  // fullscreen player (R6). Resume on close.
  useEffect(() => {
    overlayVisibleRef.current = overlayVisible
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
          (KTD4) so it can never steal D-pad focus from the action row below.

          Unmount (not just pause) while the overlay is open: on tvOS a mounted
          VideoView holds an AVPlayerLayer/decode slot even when its player is
          paused, so leaving it mounted starves the fullscreen overlay player —
          it starts then stalls on black at 0:00. R6's pause() alone is not
          enough; the slot is only freed by detaching the view. Since the
          backdrop sits entirely behind the overlay (zIndex 1000) while it
          plays, unmounting it here is invisible. The videoReady latch (kept for
          the loop seam) means it never reset on its own, so this gate is the
          piece that releases the decoder for the overlay. On close it remounts
          with videoReady still latched true (no poster re-fade) and R6 resumes. */}
      {hasValidStream && videoReady && !overlayVisible ? (
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

      {/* Ambient scrims (ported from the design's .ambient-scrim) so the
          bottom-left hero content reads cleanly over the cinematic backdrop:
          a left→right darken, a bottom→up darken, and a faint top fade. Each is
          a separate LinearGradient (RN paints one gradient per layer).
          `collapsable={false}` forces native views on Android TV so they aren't
          folded under the VideoView SurfaceView. */}
      <LinearGradient
        colors={[
          WATCH_THEME.scrim(0.92),
          WATCH_THEME.scrim(0.55),
          WATCH_THEME.scrim(0),
        ]}
        locations={[0, 0.34, 0.6]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        collapsable={false}
      />
      <LinearGradient
        colors={[
          WATCH_THEME.scrim(0.96),
          WATCH_THEME.scrim(0.5),
          WATCH_THEME.scrim(0),
        ]}
        locations={[0.04, 0.26, 0.52]}
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        collapsable={false}
      />
      <LinearGradient
        colors={[WATCH_THEME.scrim(0.5), WATCH_THEME.scrim(0)]}
        locations={[0, 0.18]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        collapsable={false}
      />

      {/* Bottom-edge fade into the section below the hero (opt-in via
          bottomFadeColor). MUST live here, inside the backdrop, AFTER the
          VideoView and with collapsable={false} — same reason the scrims above
          do: on Android TV the VideoView is a SurfaceView that renders over
          sibling RN views, so a fade placed in the parent hero would be punched
          through. Anchored to this container's bottom = the visible hero edge. */}
      {bottomFadeColor != null ? (
        <LinearGradient
          colors={[
            hexToRgba(bottomFadeColor, 0),
            hexToRgba(bottomFadeColor, 0.8),
            bottomFadeColor,
          ]}
          locations={[0, 0.65, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.bottomFade}
          pointerEvents="none"
          collapsable={false}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  // Fills the (relative) hero — full-screen cinematic backdrop, content overlaid.
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  fallbackBg: {
    backgroundColor: COLORS.surfaceContainer,
  },
  bottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_BOTTOM_FADE_HEIGHT,
  },
})
