import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import type { VideoPlayer } from "expo-video"
import { useEvent } from "expo"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  BLACK,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  hexToRgba,
} from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { applySkip } from "../../lib/scrubber"
import { SKIP_SECONDS } from "../../lib/tapSeek"
import { PlatformBlur } from "../ui/PlatformBlur"
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

// Side inset for the bar's text and icons. The inline seek bar cancels it so
// the track reaches the player's edges.
const BAR_PADDING_H = 12

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

// Frosted backplate for every chrome control. Lighter than the hero blurs so a
// 44pt control does not read as a solid block.
function Frosted({
  style,
  children,
}: {
  style: StyleProp<ViewStyle>
  children: ReactNode
}) {
  return (
    <PlatformBlur
      style={style}
      intensity={40}
      androidDim={hexToRgba(SURFACE_COLOR, 0.6)}
    >
      {children}
    </PlatformBlur>
  )
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
    // HLS duration may be 0 here, so the time/ended seed stays guarded.
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

  // Inline (portrait) docks the seek bar on the player's bottom edge, full
  // width, with the labels and the fullscreen control in the corners above it.
  // Fullscreen keeps the original centered bar above its button row.
  const scrubber = (
    <Scrubber
      currentTime={displayedTime}
      duration={duration}
      onSeek={handleSeek}
      onScrubChange={handleScrubChange}
      flush={!fullscreen}
    />
  )

  const timeLabel = (
    <Text
      style={[styles.timeText, typography.caption]}
      accessibilityLabel={`Elapsed ${formatTime(displayedTime)} of ${formatTime(duration)}`}
    >
      {formatTime(displayedTime)} / {formatTime(duration)}
    </Text>
  )

  // The pill sits where the chrome scrim has already faded out, so the backplate
  // is what keeps it legible over bright footage.
  const timePill = <Frosted style={styles.timePill}>{timeLabel}</Frosted>

  const fullscreenButton = (
    <Pressable
      onPress={() => {
        onInteract?.()
        onFullscreen?.()
      }}
      accessibilityRole="button"
      accessibilityLabel={fullscreen ? "Exit fullscreen" : "Fullscreen"}
    >
      <Frosted style={styles.iconButton}>
        <Ionicons
          name={fullscreen ? "contract" : "expand"}
          size={20}
          color={TEXT_ON_OVERLAY}
        />
      </Frosted>
    </Pressable>
  )

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.controlsRow}>
        <Pressable
          onPress={() => skip(-SKIP_SECONDS)}
          accessibilityRole="button"
          accessibilityLabel={`Back ${SKIP_SECONDS} seconds`}
        >
          <Frosted style={styles.skipButton}>
            <Ionicons
              name="play-back"
              size={24}
              color={TEXT_ON_OVERLAY}
              style={styles.centerIcon}
            />
          </Frosted>
        </Pressable>

        <Pressable
          onPress={togglePlayPause}
          accessibilityRole="button"
          accessibilityLabel={ended ? "Replay" : isPlaying ? "Pause" : "Play"}
        >
          <Frosted style={styles.playButton}>
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
          </Frosted>
        </Pressable>

        <Pressable
          onPress={() => skip(SKIP_SECONDS)}
          accessibilityRole="button"
          accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`}
        >
          <Frosted style={styles.skipButton}>
            <Ionicons
              name="play-forward"
              size={24}
              color={TEXT_ON_OVERLAY}
              style={styles.centerIcon}
            />
          </Frosted>
        </Pressable>
      </View>

      {fullscreen ? (
        <View
          style={[
            styles.bottomBar,
            // In landscape the bar would otherwise sit under the side notch and
            // the home indicator.
            {
              paddingBottom: Math.max(insets.bottom, 8),
              paddingLeft: Math.max(insets.left, 12),
              paddingRight: Math.max(insets.right, 12),
            },
          ]}
        >
          <View style={styles.timeRow}>{timePill}</View>
          {scrubber}
          <View style={styles.iconRow}>{fullscreenButton}</View>
        </View>
      ) : (
        <View style={styles.bottomBar} pointerEvents="box-none">
          {/* Docked at the player's bottom edge and rendered FIRST, so the
              corner row's button wins taps where the 44pt grab area reaches up
              behind it. box-none keeps the labels from swallowing a drag. */}
          <View style={styles.scrubberDock}>{scrubber}</View>
          <View style={styles.cornerRow} pointerEvents="box-none">
            <View pointerEvents="none">{timePill}</View>
            {fullscreenButton}
          </View>
        </View>
      )}
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
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  // Every glyph now sits on a frosted backplate. The shadow halo stays as a
  // second line of defence for WCAG 1.4.11's 3:1 bar, since blur only softens
  // bright footage rather than guaranteeing contrast against it.
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
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  // Side and bottom insets live on the rows, not here: the inline seek bar
  // needs the full width and the player's very bottom edge. Fullscreen adds its
  // own safe-area padding.
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  scrubberDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Time pill at the bottom-left, fullscreen at the bottom-right. The margin
  // clears the docked track and the thumb sitting on it.
  cornerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: BAR_PADDING_H,
    marginBottom: 12,
  },
  // overflow clips the blur to the pill's radius.
  timePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
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
    justifyContent: "flex-end",
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
})
