import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import MaterialIcons from "@expo/vector-icons/MaterialIcons"
import { VideoAirPlayButton, type VideoPlayer } from "expo-video"
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
import type { PlaybackTarget } from "../../lib/playbackTarget"
import { SKIP_SECONDS } from "../../lib/tapSeek"
import { PlatformBlur } from "../ui/PlatformBlur"
import { Scrubber } from "./Scrubber"

/** Cast button state (R1/R2) — derived by VideoPlayer, rendered here. */
export type PlayerControlsCastUi = {
  /** R2: at least one Cast device is reachable — the button hides otherwise. */
  available: boolean
  /** True during a session — flips the glyph to its connected variant. */
  connected: boolean
  /** State-aware accessibility label ("Cast" / "Casting to <device>"). */
  label: string
  onPress: () => void
}

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
  /** True while the player routes video to an external device (AirPlay).
   *  Drives the AirPlay button's state-aware accessibility label. */
  externalPlaybackActive?: boolean
  /** Null on surfaces without cast wiring (series trailer dock). */
  castUi?: PlayerControlsCastUi | null
  /** KTD4: non-null while a cast session is remote-controlling — the
   *  transport reads and writes this target, never the local player. */
  castTarget?: PlaybackTarget | null
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

/**
 * The external-route buttons (Cast + AirPlay), shared by both chrome layouts
 * AND VideoPlayer's pre-autostart veil overlay — R14 keeps both usable before
 * local playback starts, so they cannot live only in the veil-gated chrome.
 */
export function RouteButtons({
  onInteract,
  externalPlaybackActive = false,
  castUi = null,
}: {
  onInteract?: () => void
  externalPlaybackActive?: boolean
  castUi?: PlayerControlsCastUi | null
}) {
  const castButton =
    castUi != null && castUi.available ? (
      <Pressable
        onPress={() => {
          onInteract?.()
          castUi.onPress()
        }}
        accessibilityRole="button"
        accessibilityLabel={castUi.label}
      >
        <Frosted style={styles.iconButton}>
          <MaterialIcons
            name={castUi.connected ? "cast-connected" : "cast"}
            size={22}
            color={TEXT_ON_OVERLAY}
          />
        </Frosted>
      </Pressable>
    ) : null

  // Native AVRoutePickerView (iOS only) — it owns the press, so no Pressable
  // wrapper; the Frosted backplate matches the sibling icon buttons.
  const airPlayButton =
    Platform.OS === "ios" ? (
      <Frosted style={styles.iconButton}>
        <VideoAirPlayButton
          style={styles.airPlayPicker}
          tint={TEXT_ON_OVERLAY}
          activeTint={TEXT_ON_OVERLAY}
          onBeginPresentingRoutes={onInteract}
          accessibilityRole="button"
          accessibilityLabel={
            externalPlaybackActive ? "AirPlay: connected" : "AirPlay"
          }
        />
      </Frosted>
    ) : null

  return (
    <>
      {castButton}
      {airPlayButton}
    </>
  )
}

export function PlayerControls({
  player,
  fullscreen = false,
  onFullscreen,
  onInteract,
  seekSignal,
  externalPlaybackActive = false,
  castUi = null,
  castTarget = null,
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

  // KTD4 remote mode: while a session is active, every transport read and
  // write goes to the cast target; the local player stays paused untouched.
  const remote = castTarget
  const remoteMode = remote != null
  const remoteTime = remote?.currentTime
  const remoteDuration = remote?.duration
  const effectiveIsPlaying = remote != null ? remote.isPlaying : isPlaying
  const effectiveEnded = remote != null ? remote.ended : ended

  useEffect(() => {
    // remoteMode gate: the session's pause can lag playingChange, and a poll
    // tick landing then would overwrite the remote time with the local one.
    if (isPlaying && !remoteMode) {
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
  }, [isPlaying, player, remoteMode])

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

  // Remote mode: adopt the receiver's ~1s status as truth, except while the
  // finger owns the scrubber — an optimistic seek reconciles on the next tick.
  // Declared AFTER the local seed effect so a remote-mode mount reads the TV.
  useEffect(() => {
    if (!remoteMode || remoteTime == null || remoteDuration == null) return
    if (scrubbingRef.current) return
    setCurrentTime(remoteTime)
    setDuration(remoteDuration)
  }, [remoteMode, remoteTime, remoteDuration])

  const togglePlayPause = useCallback(() => {
    onInteract?.()
    if (remote != null) {
      if (remote.held) return
      if (remote.isPlaying) {
        remote.pause()
        return
      }
      // Replay on the TV: back to the start, then play (target ended).
      if (remote.ended) remote.seekTo(0)
      remote.play()
      return
    }
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
  }, [player, onInteract, remote])

  const skip = useCallback(
    (delta: number) => {
      onInteract?.()
      if (remote != null) {
        if (remote.held) return
        // Skip from the displayed (optimistic) time — the receiver's status
        // lags by up to a second and would swallow rapid repeat presses.
        const target = applySkip(currentTime, delta, remote.duration)
        if (target == null) return
        remote.seekTo(target)
        setCurrentTime(target)
        return
      }
      const target = applySkip(player.currentTime, delta, player.duration)
      if (target == null) return
      player.currentTime = target
      setCurrentTime(target)
      if (target < player.duration - 0.5) setEnded(false)
    },
    [player, onInteract, remote, currentTime],
  )

  const handleSeek = useCallback(
    (time: number) => {
      onInteract?.()
      if (remote != null) {
        if (remote.held) return
        remote.seekTo(time)
        setCurrentTime(time)
        return
      }
      player.currentTime = time
      setCurrentTime(time)
      if (time < player.duration - 0.5) setEnded(false)
    },
    [player, onInteract, remote],
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

  const routeButtons = (
    <RouteButtons
      onInteract={onInteract}
      externalPlaybackActive={externalPlaybackActive}
      castUi={castUi}
    />
  )

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* External routes live at the top-right corner, clear of the
          bottom transport rows; fullscreen clears the notch and side inset. */}
      <View
        style={[
          styles.routeRow,
          fullscreen && {
            top: Math.max(insets.top, 8),
            right: Math.max(insets.right, 12),
          },
        ]}
        pointerEvents="box-none"
      >
        {routeButtons}
      </View>

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
          accessibilityLabel={
            effectiveEnded ? "Replay" : effectiveIsPlaying ? "Pause" : "Play"
          }
        >
          <Frosted style={styles.playButton}>
            <Ionicons
              name={
                effectiveEnded
                  ? "reload"
                  : effectiveIsPlaying
                    ? "pause"
                    : "play"
              }
              size={24}
              color={TEXT_ON_OVERLAY}
              // Ionicons' style prop takes a single object, not an array.
              style={StyleSheet.flatten([
                styles.centerIcon,
                !effectiveEnded && !effectiveIsPlaying
                  ? styles.playGlyphNudge
                  : null,
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
            <View style={styles.cornerButtons}>{fullscreenButton}</View>
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
  cornerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  routeRow: {
    position: "absolute",
    top: 8,
    right: BAR_PADDING_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  // Fill the frosted circle so the native tap target is the whole control.
  airPlayPicker: {
    width: 44,
    height: 44,
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
    gap: 12,
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
