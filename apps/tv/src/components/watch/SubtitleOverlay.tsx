import { useEffect, useRef, useState } from "react"
import { Animated, Platform, StyleSheet } from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"
import { useEvent } from "expo"

import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { findActiveCue, parseVtt, type VttCue } from "../../lib/parseVtt"
import { validateActionUrl } from "../../lib/validateUrl"

// Caption colors. The TV palette (COLORS) has no on-overlay/black token, so
// the dark caption backdrop and text shadow come from a fixed black via
// hexToRgba — never the string "transparent" (causes dark banding; see
// apps/tv/CLAUDE.md and lib/colors.ts).
const SHADE = "#000000"

type SubtitleOverlayProps = {
  /** The fullscreen overlay's expo-video player; we poll its currentTime. */
  player: ExpoVideoPlayer
  /** Active subtitle track URL (CMS-sourced; validated before fetch). */
  vttSrc: string | null
  /** Distance from the bottom edge, in reference dp (scaled per platform). */
  bottomOffset?: number
  /** Horizontal inset so captions clear the safe gutter. */
  horizontalInset?: number
  /** Caption text size in reference dp (scaled per platform). */
  fontSize?: number
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
}: SubtitleOverlayProps) {
  const [cues, setCues] = useState<VttCue[]>([])
  const [activeText, setActiveText] = useState<string>("")

  // Fade the caption in/out instead of hard-cutting it as cues change. This is
  // a cosmetic local animation only — the overlay is a PASSIVE consumer of the
  // player and MUST NOT touch any control/auto-hide state (no scheduleHide /
  // revealControls). It never reaches into the player's chrome.
  const opacity = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: activeText ? 1 : 0,
      duration: 120,
      useNativeDriver: true,
    }).start()
  }, [activeText, opacity])

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
    // Reflect the current position immediately, then poll: fast (100ms) while
    // playing, slow (400ms) while paused. The slow paused poll is cheap (a
    // bounded binary search) but still catches a seek/scrub made while paused,
    // which a play-only gate would freeze the subtitle through.
    update()
    const interval = setInterval(update, isPlaying ? 100 : 400)
    return () => clearInterval(interval)
  }, [cues, player, isPlaying])

  if (!activeText) return null

  const scaledFont = px(fontSize)

  return (
    <Animated.Text
      pointerEvents="none"
      style={[
        styles.text,
        {
          opacity,
          bottom: px(bottomOffset),
          left: px(horizontalInset),
          right: px(horizontalInset),
          fontSize: scaledFont,
          lineHeight: px(fontSize * 1.3),
          paddingVertical: px(fontSize * 0.3),
          paddingHorizontal: px(fontSize * 0.65),
        },
      ]}
    >
      {activeText}
    </Animated.Text>
  )
}

const styles = StyleSheet.create({
  text: {
    position: "absolute",
    color: COLORS.text,
    fontFamily: "System",
    textAlign: "center",
    alignSelf: "center",
    backgroundColor: hexToRgba(SHADE, 0.7),
    borderRadius: 8,
    overflow: "hidden",
    textShadowColor: hexToRgba(SHADE, 0.9),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
})
