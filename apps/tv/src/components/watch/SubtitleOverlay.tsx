import { useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
} from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"
import { useEvent } from "expo"

import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { findActiveCue, parseVtt, type VttCue } from "../../lib/parseVtt"
import { validateActionUrl } from "../../lib/validateUrl"

// COLORS has no black token; caption backdrop/shadow use fixed black via
// hexToRgba — never "transparent" (banding; see apps/tv/CLAUDE.md).
const SHADE = "#000000"

type SubtitleOverlayProps = {
  /** The fullscreen overlay's expo-video player; we poll its currentTime. */
  player: ExpoVideoPlayer
  /** Active subtitle track URL (CMS-sourced; validated before fetch). */
  vttSrc: string | null
  /**
   * Distance from the bottom edge, in reference dp (scaled per platform). Host
   * raises it while player chrome shows so captions clear the bottom controls.
   */
  bottomOffset?: number
  /** Horizontal inset so captions clear the safe gutter. */
  horizontalInset?: number
  /** Caption text size in reference dp (scaled per platform). */
  fontSize?: number
  /**
   * Animate vertical-offset changes (the lift-to-clear-chrome slide, mirroring
   * apps/mobile's fullscreen caption). Snaps under reduce-motion.
   */
  animate?: boolean
}

// `fontSize` and friends arrive as reference-dp values; scale() normalises them
// to the device canvas and rounds on Android (sub-pixel = blurry per
// apps/tv/CLAUDE.md). Round here too for derived sizes (line-height/padding).
function px(value: number): number {
  const scaled = scale(value)
  return Platform.OS === "android" ? Math.round(scaled) : scaled
}

export function SubtitleOverlay({
  player,
  vttSrc,
  bottomOffset = 64,
  horizontalInset = 80,
  fontSize = 32,
  animate = false,
}: SubtitleOverlayProps) {
  const [cues, setCues] = useState<VttCue[]>([])
  const [activeText, setActiveText] = useState<string>("")

  // Cosmetic per-cue fade. The overlay is a PASSIVE consumer of the player and
  // MUST NOT touch any control/auto-hide state (no scheduleHide/revealControls).
  const opacity = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: activeText ? 1 : 0,
      duration: 120,
      useNativeDriver: true,
    }).start()
  }, [activeText, opacity])

  // translateY position (native-driver on Fabric): lifted by -bottomOffset;
  // offset changes slide 200ms when `animate`, else snap. reduce-motion is STATE
  // not a ref: its async seed lands after the first run, so a ref would miss it.
  const translateY = useRef(new Animated.Value(-px(bottomOffset))).current
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    )
    return () => {
      try {
        sub.remove()
      } catch {
        // noop
      }
    }
  }, [])
  useEffect(() => {
    if (!animate || reduceMotion) {
      translateY.setValue(-px(bottomOffset))
      return
    }
    const anim = Animated.timing(translateY, {
      toValue: -px(bottomOffset),
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    // Stop an in-flight slide on unmount / re-target (matches VideoBackdrop's
    // animation-cleanup discipline).
    return () => anim.stop()
  }, [bottomOffset, animate, reduceMotion, translateY])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  useEffect(() => {
    // Validate the CMS-sourced URL before fetching (apps/tv/CLAUDE.md).
    if (!vttSrc || !validateActionUrl(vttSrc)) {
      setCues([])
      setActiveText("")
      return
    }
    let cancelled = false
    // AbortController so switching language (or unmounting) actually cancels
    // the in-flight request instead of leaking it; the timer is the hard cap
    // so a stalled CDN can't hold the request open indefinitely.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    fetch(vttSrc, { signal: controller.signal })
      .then((r) => {
        // A CDN 4xx/5xx returns an error-page body; without this guard
        // parseVtt would silently yield zero cues and subtitles never appear.
        if (!r.ok) throw new Error(`vtt_http_${r.status}`)
        return r.text()
      })
      .then((text) => {
        if (!cancelled) {
          setCues([...parseVtt(text)].sort((a, b) => a.start - b.start))
        }
      })
      .catch(() => {
        if (!cancelled) setCues([])
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timeout)
      // Drop the old cues so the previous language's subtitles don't flash
      // against the new playhead while the next VTT is still fetching.
      setCues([])
      setActiveText("")
    }
  }, [vttSrc])

  useEffect(() => {
    if (cues.length === 0) {
      setActiveText("")
      return
    }
    const update = () => {
      try {
        const cue = findActiveCue(cues, player.currentTime)
        setActiveText((prev) => {
          const next = cue?.text ?? ""
          return prev === next ? prev : next
        })
      } catch {
        // Player released — stop touching currentTime until the next effect run.
      }
    }
    // Update now, then poll: 100ms playing, 400ms paused. The paused poll is
    // cheap and still catches a paused seek/scrub a play-only gate would freeze.
    update()
    const interval = setInterval(update, isPlaying ? 100 : 400)
    return () => clearInterval(interval)
  }, [cues, player, isPlaying])

  if (!activeText) return null

  const scaledFont = px(fontSize)

  return (
    // Bottom-anchored centering container: the inner Text HUGS its content so
    // the backdrop doesn't span full width for a short cue. translateY slides
    // the chrome-lift, opacity fades the cue — native-driver on separate nodes.
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          paddingHorizontal: px(horizontalInset),
          transform: [{ translateY }],
        },
      ]}
    >
      <Animated.Text
        style={[
          styles.text,
          {
            opacity,
            fontSize: scaledFont,
            lineHeight: px(fontSize * 1.3),
            paddingVertical: px(fontSize * 0.3),
            paddingHorizontal: px(fontSize * 0.65),
          },
        ]}
      >
        {activeText}
      </Animated.Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // Anchored at the screen's bottom edge; translateY lifts it to the live
  // bottomOffset. alignItems centers the hugging Text horizontally.
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  text: {
    maxWidth: "100%",
    color: COLORS.text,
    fontFamily: "System",
    textAlign: "center",
    backgroundColor: hexToRgba(SHADE, 0.7),
    borderRadius: 8,
    overflow: "hidden",
    textShadowColor: hexToRgba(SHADE, 0.9),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
})
