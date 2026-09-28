import { useCallback, useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
} from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"
import { useEvent } from "expo"

import { captionMeetsBox, type CaptionBox } from "../../lib/captionBox"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { datadogLog } from "../../lib/datadog"
import { LINE_HEIGHT_REDUCTION } from "../../lib/lineHeight"
import type { VttCue } from "../../lib/parseVtt"
import { loadVttCues, parseSortedVtt, pinVtt } from "../../lib/vttCache"
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
  /** Right padding only, when a column of controls sits beside the caption. */
  rightInset?: number
  /** With `rightInset`: take it only when the full-width caption covers one
   *  of these boxes, in this overlay's parent frame. Without them it always applies. */
  rightInsetBoxes?: readonly CaptionBox[]
  /** Caption text size — larger in fullscreen where the video fills the screen. */
  fontSize?: number
  /** Animate vertical-offset changes (used only in fullscreen, where the caption
   *  lifts to clear the chrome/timeline). When false, offset changes snap. */
  animate?: boolean
}

// Cues are sorted by start time. Binary-search the last cue whose start is <= t,
// then check t is still before its (exclusive) end — keeping the 100ms poll
// cheap even for a feature-length VTT with hundreds of cues.
function findActiveCue(cues: readonly VttCue[], t: number): VttCue | undefined {
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
  rightInset,
  rightInsetBoxes,
  fontSize = 16,
  animate = false,
}: SubtitleOverlayProps) {
  const [cues, setCues] = useState<readonly VttCue[]>([])
  const [activeText, setActiveText] = useState<string>("")

  // Each new cue lays out unseen at full width, and that box decides the
  // inset. The inset box cannot decide: it wraps taller and moves, so the
  // decision would flip back and forth.
  const fitKey =
    rightInset == null || rightInsetBoxes == null
      ? null
      : JSON.stringify([
          activeText,
          bottomOffset,
          fontSize,
          horizontalInset,
          rightInset,
          rightInsetBoxes,
        ])
  const [fit, setFit] = useState<{ key: string; inset: boolean } | null>(null)
  const measuring = fitKey != null && fit?.key !== fitKey
  const insetApplies = fitKey == null || (!measuring && fit?.inset === true)
  const handleTextLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (fitKey == null || rightInsetBoxes == null) return
      const { x, width, height } = e.nativeEvent.layout
      const inset = captionMeetsBox(
        {
          left: x,
          right: x + width,
          bottom: bottomOffset,
          top: bottomOffset + height,
        },
        rightInsetBoxes,
      )
      // The first layout of this cue only: later ones are the inset layout.
      setFit((prev) => (prev?.key === fitKey ? prev : { key: fitKey, inset }))
    },
    [fitKey, rightInsetBoxes, bottomOffset],
  )

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
        datadogLog.warn("subtitle.vtt_failed", { reason: "unsafe_url" })
        return
      }
      readAsStringAsync(vttSrc)
        .then((text) => {
          if (cancelled) return
          const parsed = parseSortedVtt(text)
          setCues(parsed)
          if (parsed.length === 0) {
            datadogLog.warn("subtitle.vtt_failed", { reason: "parse_empty" })
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCues([])
            datadogLog.warn("subtitle.vtt_failed", { reason: "read_error" })
          }
        })
      return () => {
        cancelled = true
        setCues([])
        setActiveText("")
      }
    }

    // Remote: the shared cue cache validates the URL, caps the bytes, and times
    // out at 8 s. The pin keeps Explore's look-ahead from evicting this track.
    const controller = new AbortController()
    const unpin = pinVtt(vttSrc)
    void loadVttCues(vttSrc, { signal: controller.signal }).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setCues(result.cues)
        return
      }
      setCues([])
      datadogLog.warn("subtitle.vtt_failed", { reason: result.reason })
    })
    return () => {
      cancelled = true
      // Detaches this overlay only: a fetch that another reader shares goes on.
      controller.abort()
      unpin()
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
        {
          paddingHorizontal: horizontalInset,
          paddingRight: insetApplies
            ? (rightInset ?? horizontalInset)
            : horizontalInset,
          transform: [{ translateY }],
        },
        measuring && styles.measuring,
      ]}
    >
      <Text
        // A new key per cue remounts the text, so its first layout always
        // fires, even when the new cue's box is the same size as the last.
        key={fitKey ?? "caption"}
        onLayout={fitKey == null ? undefined : handleTextLayout}
        style={[
          styles.text,
          {
            fontSize,
            lineHeight: Math.round(fontSize * 1.3) - LINE_HEIGHT_REDUCTION,
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
  measuring: {
    opacity: 0,
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
