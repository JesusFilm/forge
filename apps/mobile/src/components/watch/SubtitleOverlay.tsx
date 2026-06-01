import { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"

import { parseVtt, type VttCue } from "../../lib/parseVtt"
import { validateActionUrl } from "../../lib/validateUrl"

type SubtitleOverlayProps = {
  player: ExpoVideoPlayer
  vttSrc: string | null
  bottomOffset?: number
}

export function SubtitleOverlay({
  player,
  vttSrc,
  bottomOffset = 16,
}: SubtitleOverlayProps) {
  const [cues, setCues] = useState<VttCue[]>([])
  const [activeText, setActiveText] = useState<string>("")

  useEffect(() => {
    // Validate the CMS-sourced URL before fetching (apps/mobile/CLAUDE.md).
    if (!vttSrc || !validateActionUrl(vttSrc)) {
      setCues([])
      setActiveText("")
      return
    }
    let cancelled = false
    // Timeout so a stalled CDN can't hold the request open indefinitely.
    fetch(vttSrc, { signal: AbortSignal.timeout(8000) })
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setCues(parseVtt(text))
      })
      .catch(() => {
        if (!cancelled) setCues([])
      })
    return () => {
      cancelled = true
    }
  }, [vttSrc])

  useEffect(() => {
    if (cues.length === 0) {
      setActiveText("")
      return
    }
    // The effect re-runs (and the interval restarts) whenever cues changes,
    // so the closure always reads the current cues — no ref mirror needed.
    const interval = setInterval(() => {
      try {
        const t = player.currentTime
        const cue = cues.find((c) => t >= c.start && t <= c.end)
        setActiveText((prev) => {
          const next = cue?.text ?? ""
          return prev === next ? prev : next
        })
      } catch {
        // Player released
      }
    }, 100)
    return () => clearInterval(interval)
  }, [cues, player])

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
