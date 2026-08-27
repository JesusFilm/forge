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
import {
  VideoAirPlayButton,
  type VideoPlayer,
  type VideoPlayerStatus,
} from "expo-video"
import { useEvent } from "expo"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BACK_SWIPE_EDGE_WIDTH } from "../../lib/backSwipe"
import {
  BLACK,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  hexToRgba,
} from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { NativeCastButton } from "../../lib/cast/NativeCastButton"
import { applySkip } from "../../lib/scrubber"
import type { PlaybackTarget } from "../../lib/playbackTarget"
import {
  playPressAction,
  type PlayPressAction,
} from "../../lib/playPressAction"
import { playerCenterControl } from "../../lib/playerCenterControl"
import { SKIP_SECONDS } from "../../lib/tapSeek"
import { PlatformBlur } from "../ui/PlatformBlur"
import { Scrubber, SCRUBBER_HIT_HEIGHT } from "./Scrubber"

/** Cast button state (R1/R2) — derived by VideoPlayer, rendered here. */
export type PlayerControlsCastUi = {
  /** R2: at least one Cast device is reachable. iOS hides the button when false;
   *  Android ignores it, because the underlying state is untrustworthy there. */
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
  /** Opens the player settings sheet (threaded to the route row's gear). */
  onOpenSettings?: () => void
  /** Rebuilds the source after a terminal `error` status. Without it a play
   *  press on a failed stream is silently dropped (todos/024). */
  onRecover?: () => void
  /** False when the device has no usable connection. Threaded from the host so
   *  this component stays free of the native network module — every suite that
   *  renders the transport would otherwise have to mock it. */
  isOnline?: boolean
}

// Side inset for the bar's text and icons. The inline seek bar cancels it so
// the track reaches the player's edges.
const BAR_PADDING_H = 12

// Gap between the pill/exit row and the seek bar below it.
const TIME_ROW_GAP = 6

/**
 * How far above the player's bottom edge a fullscreen caption must sit to clear
 * the seek bar — its grab area plus the row gap, on top of the safe-area
 * padding the bar itself uses.
 *
 * Exported and derived rather than eyeballed: the caption lives in VideoPlayer
 * while the bar lives here, so a hard-coded number on that side silently rots
 * whenever this layout changes (it already did once, when the exit control moved
 * above the bar and left the caption floating). The pill and the exit button
 * share the caption's band and are cleared HORIZONTALLY, not vertically.
 */
export function fullscreenCaptionOffset(bottomInset: number): number {
  return Math.max(bottomInset, 8) + SCRUBBER_HIT_HEIGHT + TIME_ROW_GAP
}

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
  onOpenSettings,
}: {
  onInteract?: () => void
  externalPlaybackActive?: boolean
  castUi?: PlayerControlsCastUi | null
  /** Opens the player settings sheet. R1/R12: only the watch chrome threads
   *  it, so the veil route row and other surfaces render no gear. */
  onOpenSettings?: () => void
}) {
  // Android renders the SDK's own button because only a native, attached
  // MediaRouteButton can open the Android dialog — see NativeCastButton. iOS
  // presents the dialog from the context, so it keeps the app-drawn glyph.
  const castButton =
    castUi == null ? null : Platform.OS === "android" ? (
      // Deliberately NOT gated on `available`: getCastState() was measured
      // reporting noDevicesAvailable with devices already discovered, so the
      // gate never opens. mediarouter 1.8's button never self-hides.
      <Frosted style={styles.iconButton}>
        <NativeCastButton
          accessibilityLabel={castUi.label}
          tintColor={TEXT_ON_OVERLAY}
        />
      </Frosted>
    ) : castUi.available ? (
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

  // Same 44pt frosted backplate as its siblings, both platforms (R1).
  const settingsButton =
    onOpenSettings == null ? null : (
      <Pressable
        onPress={() => {
          onInteract?.()
          onOpenSettings()
        }}
        accessibilityRole="button"
        accessibilityLabel="Video settings"
      >
        <Frosted style={styles.iconButton}>
          <MaterialIcons name="settings" size={22} color={TEXT_ON_OVERLAY} />
        </Frosted>
      </Pressable>
    )

  return (
    <>
      {castButton}
      {airPlayButton}
      {settingsButton}
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
  onOpenSettings,
  onRecover,
  isOnline = true,
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

  // Guarded like the status read below, and for the same reason — but this is
  // the FIRST touch of the player in the render, so an unguarded throw here
  // takes the whole chrome down before either of the other guards can run.
  let seedPlaying = false
  try {
    seedPlaying = player.playing
  } catch {
    // Player already released; not-playing is the safe seed.
  }
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: seedPlaying,
  })

  // KTD4 remote mode: while a session is active, every transport read and
  // write goes to the cast target; the local player stays paused untouched.
  const remote = castTarget
  const remoteMode = remote != null
  // A cast session plays on the receiver, which has its own connection — the
  // local device being offline says nothing about it.
  const online = remote != null || isOnline

  const remoteTime = remote?.currentTime
  const remoteDuration = remote?.duration
  const effectiveIsPlaying = remote != null ? remote.isPlaying : isPlaying
  const effectiveEnded = remote != null ? remote.ended : ended

  // Reading status live rather than from a snapshot, for the same reason the
  // press handler does: a swap can change it without emitting playingChange.
  let playerStatus: VideoPlayerStatus | "" = ""
  try {
    playerStatus = player.status
  } catch {
    // Player already released; the normal controls are the safe fallback.
  }
  const centerControl = playerCenterControl({
    playing: effectiveIsPlaying,
    ended: effectiveEnded,
    status: playerStatus,
    online,
  })

  useEffect(() => {
    // remoteMode gate: the session's pause can lag playingChange, and a poll
    // tick landing then would overwrite the remote time with the local one.
    if (isPlaying && !remoteMode) {
      intervalRef.current = setInterval(() => {
        // Don't let the poll fight the finger while scrubbing (R8).
        if (scrubbingRef.current) return
        try {
          setCurrentTime(player.currentTime)
          setDuration(player.duration)
        } catch {
          // Player released between ticks; keep the last displayed time.
        }
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
    try {
      if (seekSignal.time < player.duration - 0.5) setEnded(false)
    } catch {
      // Player already released; leave the ended state as it stands.
    }
  }, [seekSignal, player])

  // Mark ended on playToEnd (the reliable end signal — the time poll stops
  // before the last frame, so currentTime alone can't detect it). Resuming
  // playback clears it.
  useEffect(() => {
    let sub: { remove: () => void } | null = null
    try {
      sub = player.addListener("playToEnd", () => setEnded(true))
    } catch {
      // Player already released; there is no end event left to hear.
      return
    }
    const attached = sub
    return () => {
      try {
        attached.remove()
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
    try {
      // HLS duration may be 0 here, so the time/ended seed stays guarded.
      const d = player.duration
      if (!Number.isFinite(d) || d <= 0) return
      const t = player.currentTime
      setCurrentTime(t)
      setDuration(d)
      setEnded(!player.playing && t >= d - 0.5)
    } catch {
      // Player already released; the chrome keeps its current seed.
    }
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
    let action: PlayPressAction
    try {
      action = playPressAction({
        playing: player.playing,
        status: player.status,
        duration: player.duration,
        currentTime: player.currentTime,
      })
    } catch {
      return // Player already released.
    }

    if (action === "pause") {
      player.pause()
      return
    }
    // play() is a no-op on an errored player, so without this the button reads
    // as dead after a dropout (todos/024). Recovery re-applies the source.
    if (action === "recover") {
      onRecover?.()
      return
    }
    if (action === "replay") {
      player.currentTime = 0
      setCurrentTime(0)
    }
    player.play()
  }, [player, onInteract, remote, onRecover])

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
      // iOS-only: there the pop recognizer competes for this touch, so the bar
      // yields the strip inline (fullscreen cannot pop, so it keeps full
      // width). Android's back is an OS gesture popped in JS — nothing to
      // yield to, so giving up the strip there would cost seek area for free.
      edgeGuardWidth={
        Platform.OS === "ios" && !fullscreen ? BACK_SWIPE_EDGE_WIDTH : 0
      }
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
      onOpenSettings={onOpenSettings}
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

        {centerControl === "offline" ? (
          // Not a button: while the device is offline there is nothing a press
          // could achieve, and a play glyph over a failed stream both hides the
          // reason and offers a retry that cannot succeed. It becomes the play
          // control again the moment the connection returns.
          <View
            accessibilityRole="image"
            accessibilityLabel="No connection. The video cannot play."
          >
            <Frosted style={styles.playButton}>
              <MaterialIcons
                name="wifi-off"
                size={24}
                color={TEXT_ON_OVERLAY}
                style={styles.centerIcon}
              />
            </Frosted>
          </View>
        ) : (
          <Pressable
            onPress={togglePlayPause}
            accessibilityRole="button"
            accessibilityLabel={
              centerControl === "replay"
                ? "Replay"
                : centerControl === "pause"
                  ? "Pause"
                  : "Play"
            }
          >
            <Frosted style={styles.playButton}>
              <Ionicons
                name={
                  centerControl === "replay"
                    ? "reload"
                    : centerControl === "pause"
                      ? "pause"
                      : "play"
                }
                size={24}
                color={TEXT_ON_OVERLAY}
                // Ionicons' style prop takes a single object, not an array.
                style={StyleSheet.flatten([
                  styles.centerIcon,
                  centerControl === "play" ? styles.playGlyphNudge : null,
                ])}
              />
            </Frosted>
          </Pressable>
        )}

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
          {/* Exit sits ABOVE the seek bar. Below it, its 44pt row pushed the
              bar up off the bottom edge — the whole point of landscape is that
              the bar hugs the screen's bottom. `timeRow` is already
              space-between, so the pill keeps the left and exit takes the right. */}
          <View style={styles.timeRow}>
            {timePill}
            <View style={styles.iconRow}>{fullscreenButton}</View>
          </View>
          {scrubber}
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
    marginBottom: TIME_ROW_GAP,
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
