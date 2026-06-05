import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import type { VideoPlayer } from "expo-video"
import { useEvent } from "expo"

import { TEXT_ON_OVERLAY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { applySkip } from "../../lib/scrubber"
import { SKIP_SECONDS } from "../../lib/tapSeek"
import { Scrubber } from "./Scrubber"

type PlayerControlsProps = {
  player: VideoPlayer
  /** True while in custom fullscreen — flips the control to an exit affordance. */
  fullscreen?: boolean
  onFullscreen?: () => void
  /** Called when any control is used, so the auto-hide timer resets (R4). */
  onInteract?: () => void
  /** A seek performed outside this component (double-tap-the-sides). The bumped
   *  nonce updates the displayed time immediately, even while paused. */
  seekSignal?: { time: number; n: number } | null
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function PlayerControls({
  player,
  fullscreen = false,
  onFullscreen,
  onInteract,
  seekSignal,
}: PlayerControlsProps) {
  const typography = useTypography()
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [scrubPreview, setScrubPreview] = useState<number | null>(null)
  // True once playback reaches the end — the center control becomes Replay.
  const [ended, setEnded] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Mirror scrubbing into a ref so the poll closure (set up on [isPlaying])
  // reads the live value without re-subscribing.
  const scrubbingRef = useRef(false)

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        // Don't let the poll fight the finger while scrubbing (R8).
        if (scrubbingRef.current) return
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

  // Reflect an external seek (double-tap-the-sides) in the label/scrubber at
  // once — the poll is idle while paused, so without this the time would lag.
  // Clear `ended` when the seek lands before the end (mirrors skip/handleSeek),
  // else a double-tap-rewind from the end leaves the center stuck on Replay.
  useEffect(() => {
    if (!seekSignal) return
    setCurrentTime(seekSignal.time)
    if (seekSignal.time < player.duration - 0.5) setEnded(false)
  }, [seekSignal, player])

  // Mark ended on playToEnd (the reliable end signal — the time poll stops
  // before the last frame, so currentTime alone can't detect it). Resuming
  // playback clears it.
  useEffect(() => {
    const sub = player.addListener("playToEnd", () => setEnded(true))
    return () => {
      try {
        sub.remove()
      } catch {
        // player already released
      }
    }
  }, [player])
  useEffect(() => {
    if (isPlaying) setEnded(false)
  }, [isPlaying])

  // Seed from the live player on (re)mount. The controls unmount when the
  // chrome hides; without this, re-showing them resets to 0:00 / play because
  // the fresh component starts at 0 and the poll only runs while playing — so a
  // paused or ended video would lose its position and the replay state.
  useEffect(() => {
    // Mute is read first and unconditionally: it persists on the player across
    // a chrome hide/show, but this fresh mount's useState(false) would otherwise
    // show an un-muted icon while audio stays muted. (Duration may still be 0
    // here on HLS, so the time/ended seed stays behind the guard below.)
    setIsMuted(player.muted)
    const d = player.duration
    if (!Number.isFinite(d) || d <= 0) return
    const t = player.currentTime
    setCurrentTime(t)
    setDuration(d)
    setEnded(!player.playing && t >= d - 0.5)
  }, [player])

  const togglePlayPause = useCallback(() => {
    onInteract?.()
    // Read the live player state, NOT the React `isPlaying` snapshot. A source
    // swap (e.g. switching language mid-play) can leave expo-video paused
    // without emitting a playingChange, so the snapshot goes stale-true.
    // Trusting it would call pause() on an already-paused player every press —
    // wedging the controls so the video can never be resumed without a remount.
    if (player.playing) {
      player.pause()
      return
    }
    // Replay from the start if the video has reached the end — otherwise
    // play() is a no-op on a finished video and nothing happens.
    const dur = player.duration
    if (Number.isFinite(dur) && dur > 0 && player.currentTime >= dur - 0.5) {
      player.currentTime = 0
      setCurrentTime(0)
    }
    player.play()
  }, [player, onInteract])

  const toggleMute = useCallback(() => {
    onInteract?.()
    const newMuted = !isMuted
    player.muted = newMuted
    setIsMuted(newMuted)
  }, [player, isMuted, onInteract])

  const skip = useCallback(
    (delta: number) => {
      onInteract?.()
      const target = applySkip(player.currentTime, delta, player.duration)
      if (target == null) return
      player.currentTime = target
      setCurrentTime(target)
      if (target < player.duration - 0.5) setEnded(false)
    },
    [player, onInteract],
  )

  const handleSeek = useCallback(
    (time: number) => {
      onInteract?.()
      player.currentTime = time
      setCurrentTime(time)
      if (time < player.duration - 0.5) setEnded(false)
    },
    [player, onInteract],
  )

  const handleScrubChange = useCallback(
    (active: boolean, previewTime: number | null) => {
      scrubbingRef.current = active
      setScrubPreview(active ? previewTime : null)
      if (active) onInteract?.()
    },
    [onInteract],
  )

  const displayedTime = scrubPreview != null ? scrubPreview : currentTime

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.controlsRow}>
        <Pressable
          onPress={() => skip(-SKIP_SECONDS)}
          style={styles.skipButton}
          accessibilityRole="button"
          accessibilityLabel={`Back ${SKIP_SECONDS} seconds`}
        >
          <Ionicons name="play-back" size={24} color={TEXT_ON_OVERLAY} />
        </Pressable>

        <Pressable
          onPress={togglePlayPause}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={ended ? "Replay" : isPlaying ? "Pause" : "Play"}
        >
          <Ionicons
            name={ended ? "reload" : isPlaying ? "pause" : "play"}
            size={24}
            color={TEXT_ON_OVERLAY}
            style={!ended && !isPlaying ? { marginLeft: 3 } : undefined}
          />
        </Pressable>

        <Pressable
          onPress={() => skip(SKIP_SECONDS)}
          style={styles.skipButton}
          accessibilityRole="button"
          accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`}
        >
          <Ionicons name="play-forward" size={24} color={TEXT_ON_OVERLAY} />
        </Pressable>
      </View>

      <View style={styles.bottomBar}>
        <View style={styles.timeRow}>
          <Text style={[styles.timeText, typography.caption]}>
            {formatTime(displayedTime)}
          </Text>
          <Text style={[styles.timeText, typography.caption]}>
            {formatTime(duration)}
          </Text>
        </View>
        <Scrubber
          currentTime={displayedTime}
          duration={duration}
          onSeek={handleSeek}
          onScrubChange={handleScrubChange}
        />
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
              onPress={() => {
                onInteract?.()
                onFullscreen?.()
              }}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              <Ionicons
                name={fullscreen ? "contract" : "expand"}
                size={20}
                color={TEXT_ON_OVERLAY}
              />
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
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 28,
  },
  skipButton: {
    width: 48,
    height: 48,
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
