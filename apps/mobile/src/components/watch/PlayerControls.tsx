import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import type { VideoPlayer } from "expo-video"
import { useEvent } from "expo"

import { ACCENT, TEXT_ON_OVERLAY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"

type PlayerControlsProps = {
  player: VideoPlayer
  onFullscreen: () => void
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function PlayerControls({ player, onFullscreen }: PlayerControlsProps) {
  const typography = useTypography()
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentTime(player.currentTime)
        setDuration(player.duration)
      }, 500)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPlaying, player])

  const togglePlayPause = useCallback(() => {
    // Read the live player state, NOT the React `isPlaying` snapshot. A source
    // swap (e.g. switching language mid-play) can leave expo-video paused
    // without emitting a playingChange, so the snapshot goes stale-true.
    // Trusting it would call pause() on an already-paused player every press —
    // wedging the controls so the video can never be resumed without a remount.
    if (player.playing) {
      player.pause()
    } else {
      player.play()
    }
  }, [player])

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted
    player.muted = newMuted
    setIsMuted(newMuted)
  }, [player, isMuted])

  const progress = duration > 0 ? currentTime / duration : 0

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.controlsRow}>
        <Pressable
          onPress={togglePlayPause}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
        >
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={24}
            color={TEXT_ON_OVERLAY}
            style={isPlaying ? undefined : { marginLeft: 3 }}
          />
        </Pressable>
      </View>

      <View style={styles.bottomBar}>
        <View style={styles.timeRow}>
          <Text style={[styles.timeText, typography.caption]}>
            {formatTime(currentTime)}
          </Text>
          <Text style={[styles.timeText, typography.caption]}>
            {formatTime(duration)}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${progress * 100}%` }]}
          />
        </View>
        <View style={styles.iconRow}>
          <Pressable
            onPress={toggleMute}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? "Unmute" : "Mute"}
          >
            <Ionicons
              name={isMuted ? "volume-mute" : "volume-high"}
              size={20}
              color={TEXT_ON_OVERLAY}
            />
          </Pressable>
          <View style={styles.rightIconGroup}>
            <Pressable
              onPress={onFullscreen}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Fullscreen"
            >
              <Ionicons name="expand" size={20} color={TEXT_ON_OVERLAY} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  controlsRow: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  progressTrack: {
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 1.5,
    marginBottom: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: ACCENT,
    borderRadius: 1.5,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  timeText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rightIconGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
})
