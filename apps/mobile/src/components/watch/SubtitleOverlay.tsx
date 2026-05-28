import { useEffect, useRef, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"

import { parseVtt, type VttCue } from "../../lib/parseVtt"

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
  const cuesRef = useRef<VttCue[]>([])

  useEffect(() => {
    cuesRef.current = cues
  }, [cues])

  useEffect(() => {
    if (!vttSrc) {
      setCues([])
      setActiveText("")
      return
    }
    let cancelled = false
    fetch(vttSrc)
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
    const interval = setInterval(() => {
      try {
        const t = player.currentTime
        const cue = cuesRef.current.find((c) => t >= c.start && t <= c.end)
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
