import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import type { VideoPlayer } from "expo-video"
import { useEvent } from "expo"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
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
  const insets = useSafeAreaInsets()
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

  // Reflect an external seek (double-tap-sides) at once — the poll is idle while
  // paused. Clear `ended` when it lands before the end (mirrors skip/handleSeek),
  // else a rewind from the end leaves the center stuck on Replay.
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

  // Seed from the live player on (re)mount. Controls unmount when chrome hides;
  // without this, re-showing resets to 0:00/play, losing a paused or ended
  // video's position and replay state (poll only runs while playing).
  useEffect(() => {
    // Mute is read first, unconditionally: it persists across chrome hide/show,
    // but this mount's useState(false) would show an un-muted icon over muted
    // audio. (HLS duration may be 0 here, so time/ended seed stays guarded below.)
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
    // Read live player state, NOT the React `isPlaying` snapshot: a source swap
    // (e.g. mid-play language switch) can pause expo-video without a
    // playingChange, so the stale-true snapshot would wedge controls until remount.
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
          <Ionicons
            name="play-back"
            size={24}
            color={TEXT_ON_OVERLAY}
            style={styles.centerIcon}
          />
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
            // Ionicons' style prop takes a single object, not an array.
            style={StyleSheet.flatten([
              styles.centerIcon,
              !ended && !isPlaying ? styles.playGlyphNudge : null,
            ])}
          />
        </Pressable>

        <Pressable
          onPress={() => skip(SKIP_SECONDS)}
          style={styles.skipButton}
          accessibilityRole="button"
          accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`}
        >
          <Ionicons
            name="play-forward"
            size={24}
            color={TEXT_ON_OVERLAY}
            style={styles.centerIcon}
          />
        </Pressable>
      </View>

      <View
        style={[
          styles.bottomBar,
          // In landscape fullscreen the bar would otherwise sit under the side
          // notch and the home indicator. Inline (16:9 box) needs no insets.
          fullscreen && {
            paddingBottom: Math.max(insets.bottom, 8),
            paddingLeft: Math.max(insets.left, 12),
            paddingRight: Math.max(insets.right, 12),
          },
        ]}
      >
        <View style={styles.timeRow}>
          <Text
            style={[styles.timeText, typography.caption]}
            accessibilityLabel={`Elapsed ${formatTime(displayedTime)} of ${formatTime(duration)}`}
          >
            {formatTime(displayedTime)}
          </Text>
          {/* The total is already spoken in the elapsed label above; hide this
              duplicate from screen readers so the position isn't announced twice. */}
          <Text
            style={[styles.timeText, typography.caption]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
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
    ...StyleSheet.absoluteFill,
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
  // The center cluster sits above the scrim, so white glyphs need own contrast
  // over bright frames. Skip glyphs lean on this shadow halo (like the captions)
  // to clear WCAG 1.4.11's 3:1 bar against any footage; the play button has a backplate.
  centerIcon: {
    textShadowColor: hexToRgba(BLACK, 0.6),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  playGlyphNudge: {
    marginLeft: 3,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: hexToRgba(BLACK, 0.5),
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
