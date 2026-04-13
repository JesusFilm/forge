import { useEffect, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

// ── Design System ───────────────────────────────────────────────────────────

const COLORS = {
  surface: "#161311",
  surfaceContainerGlass: "rgba(34, 31, 29, 0.7)",
  crimson: "#CB333B",
  text: "#F5F5F4",
  muted: "#A8A29E",
} as const

// ── Types ───────────────────────────────────────────────────────────────────

export interface VideoPlayerProps {
  streamingUrl: string
  title?: string
  subtitle?: string
  onDismiss: () => void
}

// ── Component ───────────────────────────────────────────────────────────────

export function VideoPlayer({
  streamingUrl,
  title,
  subtitle,
  onDismiss,
}: VideoPlayerProps) {
  const [isPaused, setIsPaused] = useState(false)
  const [isPlayPauseFocused, setIsPlayPauseFocused] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Keep source reference stable per the institutional learning:
  // useVideoPlayer(source) — source must be stable.
  const sourceRef = useRef(streamingUrl)
  sourceRef.current = streamingUrl

  const player = useVideoPlayer(sourceRef.current, (p) => {
    p.timeUpdateEventInterval = 1
  })

  // Auto-play on mount
  useEffect(() => {
    player.play()
  }, [player])

  // Listen to playToEnd for auto-dismiss
  useEffect(() => {
    const subscription = player.addListener("playToEnd", () => {
      onDismiss()
    })
    return () => {
      subscription.remove()
    }
  }, [player, onDismiss])

  // Track playing state changes
  useEffect(() => {
    const subscription = player.addListener(
      "playingChange",
      ({ isPlaying }) => {
        setIsPaused(!isPlaying)
      },
    )
    return () => {
      subscription.remove()
    }
  }, [player])

  // Track time updates
  useEffect(() => {
    const subscription = player.addListener("timeUpdate", (payload) => {
      setCurrentTime(payload.currentTime)
    })
    return () => {
      subscription.remove()
    }
  }, [player])

  // Track duration from sourceLoad
  useEffect(() => {
    const subscription = player.addListener("sourceLoad", (payload) => {
      setDuration(payload.duration)
    })
    return () => {
      subscription.remove()
    }
  }, [player])

  // Pause on unmount
  useEffect(() => {
    return () => {
      player.pause()
    }
  }, [player])

  const togglePlayPause = () => {
    if (player.playing) {
      player.pause()
    } else {
      player.play()
    }
  }

  return (
    <View style={styles.overlay}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls={false}
        contentFit="contain"
      />

      {/* Back hint — top left */}
      <View style={styles.backHintContainer}>
        <Pressable onPress={onDismiss} style={styles.backButton}>
          <Text style={styles.backHintText}>{"← Back"}</Text>
        </Pressable>
      </View>

      {/* Transport controls — bottom glassmorphism bar */}
      <View style={styles.transportBar}>
        {/* Left: title + subtitle */}
        <View style={styles.transportLeft}>
          {title != null && (
            <Text style={styles.transportTitle} numberOfLines={1}>
              {title}
            </Text>
          )}
          {subtitle != null && (
            <Text style={styles.transportSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        {/* Center: play/pause */}
        <Pressable
          onPress={togglePlayPause}
          onFocus={() => setIsPlayPauseFocused(true)}
          onBlur={() => setIsPlayPauseFocused(false)}
          style={[
            styles.playPauseButton,
            isPlayPauseFocused && styles.playPauseButtonFocused,
          ]}
          hasTVPreferredFocus
        >
          <Text style={styles.playPauseText}>{isPaused ? "▶" : "⏸"}</Text>
        </Pressable>

        {/* Right: time display */}
        <View style={styles.transportRight}>
          <Text style={styles.timeText}>
            {formatTime(currentTime)}
            {duration > 0 ? ` / ${formatTime(duration)}` : ""}
          </Text>
        </View>
      </View>

      {/* NOTE: Seek controls (rewind/fast-forward via TV remote) are deferred.
          Implementing seek requires native TV remote event listeners (e.g.,
          TVEventHandler or platform-specific swipe gestures) which adds
          complexity beyond the prototype scope. */}
    </View>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.surface,
    zIndex: 1000,
  },
  backHintContainer: {
    position: "absolute",
    top: 40,
    left: 48,
    zIndex: 1001,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  backHintText: {
    fontFamily: "System",
    fontSize: 16,
    color: COLORS.muted,
  },
  transportBar: {
    position: "absolute",
    bottom: 40,
    left: 48,
    right: 48,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surfaceContainerGlass,
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 16,
    zIndex: 1001,
  },
  transportLeft: {
    flex: 1,
    marginRight: 16,
  },
  transportTitle: {
    fontFamily: "System",
    fontSize: 18,
    fontWeight: "500",
    color: COLORS.text,
  },
  transportSubtitle: {
    fontFamily: "System",
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 2,
  },
  playPauseButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  playPauseButtonFocused: {
    backgroundColor: COLORS.crimson,
    shadowColor: COLORS.crimson,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 8,
  },
  playPauseText: {
    fontSize: 24,
    color: COLORS.text,
  },
  transportRight: {
    flex: 1,
    alignItems: "flex-end",
    marginLeft: 16,
  },
  timeText: {
    fontFamily: "System",
    fontSize: 14,
    color: COLORS.muted,
    fontVariant: ["tabular-nums"],
  },
})
