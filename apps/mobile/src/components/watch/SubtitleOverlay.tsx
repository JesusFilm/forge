import { useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
} from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"
import { useEvent } from "expo"

import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { parseVtt, type VttCue } from "../../lib/parseVtt"
import { validateActionUrl } from "../../lib/validateUrl"
import { validateLocalMediaUrl } from "../../lib/validateLocalMediaUrl"
import { OFFLINE_ROOT } from "../../lib/offlineFileSystem"
import { readAsStringAsync } from "expo-file-system/legacy"

type SubtitleOverlayProps = {
  player: ExpoVideoPlayer
  vttSrc: string | null
  bottomOffset?: number
  /** Horizontal padding so captions clear the notch / home-indicator in
   *  landscape fullscreen. Defaults to the inline value. */
  horizontalInset?: number
  /** Caption text size — larger in fullscreen where the video fills the screen. */
  fontSize?: number
  /** Animate vertical-offset changes (used only in fullscreen, where the caption
   *  lifts to clear the chrome/timeline). When false, offset changes snap. */
  animate?: boolean
}

// Cues are sorted by start time. Binary-search the last cue whose start is <= t,
// then check t is still before its (exclusive) end — keeping the 100ms poll
// cheap even for a feature-length VTT with hundreds of cues.
function findActiveCue(cues: VttCue[], t: number): VttCue | undefined {
  let lo = 0
  let hi = cues.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // `ans` (last cue starting at or before t) is usually active, but cues can
  // overlap so an earlier longer cue may still be active. Walk back a BOUNDED
  // number of steps — keeps a gap in a long non-overlapping VTT O(1).
  for (
    let i = ans, steps = 0;
    i >= 0 && steps < 16 && cues[i].start <= t;
    i--, steps++
  ) {
    if (t < cues[i].end) return cues[i]
  }
  return undefined
}

export function SubtitleOverlay({
  player,
  vttSrc,
  bottomOffset = 16,
  horizontalInset = 16,
  fontSize = 16,
  animate = false,
}: SubtitleOverlayProps) {
  const [cues, setCues] = useState<VttCue[]>([])
  const [activeText, setActiveText] = useState<string>("")

  // Vertical offset via translateY (native-driver friendly on Fabric), anchored
  // at bottom:0 and lifted by -bottomOffset. Animated only when `animate`
  // (fullscreen lift); otherwise snaps so inline captions never move.
  const translateY = useRef(new Animated.Value(-bottomOffset)).current
  const reduceMotionRef = useRef(false)
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduceMotionRef.current = v
    })
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => {
        reduceMotionRef.current = v
      },
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
    if (!animate || reduceMotionRef.current) {
      translateY.setValue(-bottomOffset)
      return
    }
    Animated.timing(translateY, {
      toValue: -bottomOffset,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [bottomOffset, animate, translateY])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  useEffect(() => {
    if (!vttSrc) {
      setCues([])
      setActiveText("")
      return
    }
    let cancelled = false

    // Offline: a locally-saved VTT is read from disk (validated against the
    // download root). fetch / validateActionUrl reject the file: scheme.
    if (vttSrc.startsWith("file:")) {
      if (!validateLocalMediaUrl(vttSrc, OFFLINE_ROOT)) {
        setCues([])
        setActiveText("")
        return
      }
      readAsStringAsync(vttSrc)
        .then((text) => {
          if (!cancelled) {
            setCues([...parseVtt(text)].sort((a, b) => a.start - b.start))
          }
        })
        .catch(() => {
          if (!cancelled) setCues([])
        })
      return () => {
        cancelled = true
        setCues([])
        setActiveText("")
      }
    }

    // Remote: validate the CMS-sourced URL before fetching (apps/mobile/CLAUDE.md).
    if (!validateActionUrl(vttSrc)) {
      setCues([])
      setActiveText("")
      return
    }
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
        // Player released
      }
    }
    // Reflect position immediately, then poll: 100ms playing, 400ms paused. The
    // slow paused poll is cheap but still catches a seek/scrub made while paused,
    // which a play-only gate would freeze the subtitle through.
    update()
    const interval = setInterval(update, isPlaying ? 100 : 400)
    return () => clearInterval(interval)
  }, [cues, player, isPlaying])

  if (!activeText) return null

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { paddingHorizontal: horizontalInset, transform: [{ translateY }] },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            fontSize,
            lineHeight: Math.round(fontSize * 1.3),
            paddingVertical: Math.round(fontSize * 0.3),
            paddingHorizontal: Math.round(fontSize * 0.65),
          },
        ]}
      >
        {activeText}
      </Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  text: {
    color: TEXT_ON_OVERLAY,
    fontSize: 16,
    fontFamily: "System",
    textAlign: "center",
    backgroundColor: hexToRgba(BLACK, 0.7),
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: "hidden",
    textShadowColor: hexToRgba(BLACK, 0.9),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
})
