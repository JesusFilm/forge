import { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"
import { useEvent } from "expo"

import { parseVtt, type VttCue } from "../../lib/parseVtt"
import { validateActionUrl } from "../../lib/validateUrl"

type SubtitleOverlayProps = {
  player: ExpoVideoPlayer
  vttSrc: string | null
  bottomOffset?: number
}

// Cues are sorted by start time, so the active cue is the last one whose start
// is <= t, provided t is still before its (exclusive) end. Binary search keeps
// the 100ms poll cheap even for a feature-length VTT with hundreds of cues.
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
  if (ans >= 0 && t < cues[ans].end) return cues[ans]
  return undefined
}

export function SubtitleOverlay({
  player,
  vttSrc,
  bottomOffset = 16,
}: SubtitleOverlayProps) {
  const [cues, setCues] = useState<VttCue[]>([])
  const [activeText, setActiveText] = useState<string>("")

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  useEffect(() => {
    // Validate the CMS-sourced URL before fetching (apps/mobile/CLAUDE.md).
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
    // Reflect the current position immediately (covers paused-at-a-cue), then
    // only poll while playing — no need to scan cues 10x/s on a paused or
    // backgrounded player.
    update()
    if (!isPlaying) return
    const interval = setInterval(update, 100)
    return () => clearInterval(interval)
  }, [cues, player, isPlaying])

  if (!activeText) return null

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { bottom: bottomOffset }]}
    >
      <Text style={styles.text}>{activeText}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  text: {
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "System",
    textAlign: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: "hidden",
    textShadowColor: "rgba(0, 0, 0, 0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
})
