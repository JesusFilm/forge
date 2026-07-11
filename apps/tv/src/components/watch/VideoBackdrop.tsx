// Muted, non-interactive cinematic backdrop: poster-hold → video-fade-in (no
// black flash), paused while the overlay player is open (R6). Zero focusables
// (KTD4/KTD8); collapsable={false} on Android vs VideoView SurfaceView z-order.

import { useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  AppState,
  StyleSheet,
  View,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"

import { hexToRgba } from "../../lib/colors"
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
   * True while the fullscreen overlay player is visible. Preview pauses while
   * open and resumes on close (R6) — only one player decodes at a time.
   */
  overlayVisible: boolean
  /**
   * Optional bottom-edge fade color blending the hero into the section below.
   * Rendered LAST with collapsable={false} so it composites over the Android
   * VideoView SurfaceView (see apps/tv/CLAUDE.md "Android TV VideoView z-order").
   */
  bottomFadeColor?: string | null
  /**
   * Mute the backdrop audio. Defaults to true — every sibling hero (watch, Home,
   * Search) is muted. The Experience hero opts into sound with muted={false}.
   */
  muted?: boolean
  /**
   * External play gate (default true = today's behavior). When provided, the
   * backdrop plays only while active AND no overlay is open. The Experience hero
   * passes onScreen && screen-focused so it pauses when scrolled off or navigated
   * away; siblings omit it and stay gated by the overlay alone.
   */
  active?: boolean
}

export function VideoBackdrop({
  streamingUrl,
  posterUrl,
  overlayVisible,
  bottomFadeColor,
  muted = true,
  active = true,
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

  // Pause + release the decode slot while the app isn't foreground: a backgrounded
  // app must not keep decoding, and the sound hero must not play audio behind the
  // OS or screensaver (R15). Universal — siblings release their slot too, resuming
  // on foreground. (Screensaver coverage is best-effort: tvOS may stay "active"
  // under the screensaver, in which case audio isn't caught here — a known gap.)
  const [appForeground, setAppForeground] = useState(
    AppState.currentState === "active",
  )
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppForeground(next === "active")
    })
    return () => sub.remove()
  }, [])

  // Single play gate: one derived boolean feeds the one play/pause effect below,
  // so overlay/scroll/lifecycle never race into two concurrent decoders (KTD4).
  const shouldPlay = active && !overlayVisible && appForeground

  // Freeze the useVideoPlayer source: a changing source RELEASES + recreates the
  // player (black/stuck frame). Seed with the first source and route later swaps
  // (e.g. dub switches) through replaceAsync — mirrors VideoPlayer.tsx.
  const creationSource = useRef(validStream).current
  const player = useVideoPlayer(creationSource, (p) => {
    p.muted = muted
    // Looped manually via the playToEnd listener below — the native `loop` left a
    // long black pause before restarting (it re-buffers the HLS seek). With the
    // VideoView kept mounted (videoReady latches), replay() restarts instantly.
    p.loop = false
  })

  // Keep muted in sync if the prop flips after creation (the initializer runs once).
  useEffect(() => {
    try {
      player.muted = muted
    } catch {
      // Native player already released; benign.
    }
  }, [player, muted])

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
  // Mirrors shouldPlay for the playToEnd listener (reads it at call time without
  // re-registering the listener on every gate change).
  const shouldPlayRef = useRef(shouldPlay)

  useEffect(() => {
    if (!hasValidStream) {
      setVideoReady(false)
      return
    }
    if (player.status === "readyToPlay") setVideoReady(true)
    const sub = player.addListener("statusChange", ({ status }) => {
      // Latch true once ready and KEEP it through `idle`: a transient idle blip
      // at the loop seam must not unmount the VideoView, since remounting
      // re-inits HLS — that was the long black pause at the loop point.
      if (status === "readyToPlay") setVideoReady(true)
      // A genuine `error` is never a loop-seam blip — fall back to the poster so
      // a permanent failure (expired HLS token, CDN outage, decode error) doesn't
      // strand the hero on a frozen frame. `idle` is deliberately NOT reset.
      else if (status === "error") setVideoReady(false)
    })
    return () => sub.remove()
  }, [player, hasValidStream])

  // Immediate loop: replay at end. Driving it ourselves (loop=false above) keeps
  // the player mounted so replay() is a fast in-player seek, not an HLS re-init.
  // Only fires while playing, so it respects the overlay-pause for free.
  useEffect(() => {
    if (!hasValidStream) return
    const sub = player.addListener("playToEnd", () => {
      // Guard the pause race: if we were paused (overlay opened, hero scrolled
      // off, or app backgrounded) right at the loop seam, a queued playToEnd must
      // not resume the backdrop into two concurrent decoders (R11).
      if (!shouldPlayRef.current) return
      try {
        player.replay()
      } catch {
        // Native player already released; benign.
      }
    })
    return () => sub.remove()
  }, [player, hasValidStream])

  // One play/pause effect driven by the single shouldPlay gate. Pausing while the
  // overlay plays (or the hero is scrolled off) keeps a single decoder active and
  // frees the backdrop's frame budget for the fullscreen player (R11/KTD4).
  useEffect(() => {
    shouldPlayRef.current = shouldPlay
    if (!hasValidStream) return
    try {
      if (shouldPlay) player.play()
      else player.pause()
    } catch {
      // Native player already released; benign.
    }
  }, [player, hasValidStream, shouldPlay])

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
          contentPosition="top left"
          recyclingKey={`backdrop-${posterUrl}`}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
      )}

      {/* Video — crossfaded in over the poster once ready; KTD4 pointerEvents.
          UNMOUNTED (not just paused) while the overlay is open OR the app is
          backgrounded: a mounted tvOS VideoView holds a decode slot even paused,
          starving the overlay (black at 0:00). Scroll-off only pauses (stays
          mounted for instant resume — no competing player there). */}
      {hasValidStream && videoReady && !overlayVisible && appForeground ? (
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

      {/* Ambient scrims so bottom-left hero content reads over the backdrop:
          left→right + bottom→up darken + faint top fade, one LinearGradient each.
          collapsable={false} keeps them above the Android VideoView SurfaceView. */}
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

      {/* Bottom-edge fade into the section below (opt-in via bottomFadeColor).
          MUST live here, AFTER the VideoView, collapsable={false}: the Android
          SurfaceView punches through a parent-hero fade. Anchored to hero edge. */}
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
    backgroundColor: WATCH_THEME.below,
  },
  bottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_BOTTOM_FADE_HEIGHT,
  },
})
