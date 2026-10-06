// The video parts of a run (R12-R15, R24, R26). One player and one view stay
// mounted across the three parts (KTD7). Each part plays from its start and
// stops a guard length before its end behind an opaque cover, so no frame or
// sound of a skipped range reaches the screen (KTD8). Only the viewer's tap
// pauses or resumes a part, and an interruption holds it (KTD9).
import Ionicons from "@expo/vector-icons/Ionicons"
import { VideoView, type VideoPlayer } from "expo-video"
import { useEffect, useRef, useState } from "react"
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useManagedVideoPlayer } from "../../hooks/useManagedVideoPlayer"
import {
  useDevotionalVideo,
  type Devotional,
  type DevotionalPart,
  type PartRange,
} from "../../lib/dailyPause/devotionals"
import {
  PART_TICK_SECONDS,
  partProgress,
  partStarted,
  partStopDue,
  projectClock,
  startBackstopDue,
  startClock,
  startGateOpen,
  tickClock,
  watchMode,
} from "../../lib/dailyPause/partClock"
import {
  pauseColors,
  pauseSizes,
  pauseSpacing,
} from "../../lib/dailyPause/theme"
import { devotionalVideoFrame } from "../../lib/dailyPause/videoFrame"
import { PartProgressBar } from "./PartProgressBar"
import type { PauseFont } from "../../lib/dailyPause/fonts"
import { PauseButton } from "./PauseFrame"

const CUE_HEIGHT = 44
const CUE_GLYPH_SIZE = 14

type PartPlayerProps = {
  devotional: Devotional
  /** The part that plays now, or the next part while the run is between. */
  part: DevotionalPart
  /** False between parts: the part waits at its start, paused and covered. */
  active: boolean
  /** False while another screen covers the run: the part holds until a tap. */
  focused: boolean
  font: PauseFont
  /** Called once, when the part reaches its stop. */
  onEnded: () => void
}

export function PartPlayer({
  devotional,
  part,
  active,
  focused,
  font,
  onEnded,
}: PartPlayerProps) {
  // "Try again" loads the file again and mounts a new player.
  const [attempt, setAttempt] = useState(0)
  const video = useDevotionalVideo(devotional, attempt)
  const retry = () => setAttempt((count) => count + 1)

  if (video.status === "error") {
    return (
      <View style={styles.fill}>
        <View testID="part-cover" pointerEvents="none" style={styles.fill} />
        {active ? <FailedNotice font={font} onRetry={retry} /> : null}
      </View>
    )
  }
  if (video.status !== "ready") {
    return <View testID="part-cover" pointerEvents="none" style={styles.fill} />
  }
  return (
    <PartVideo
      key={attempt}
      uri={video.uri}
      range={devotional.parts[part]}
      active={active}
      focused={focused}
      font={font}
      onEnded={onEnded}
      onRetry={retry}
    />
  )
}

/** A part that cannot play, and the one way on. */
function FailedNotice({
  font,
  onRetry,
}: {
  font: PauseFont
  onRetry: () => void
}) {
  return (
    <View style={styles.failed}>
      <Text style={[styles.failedLabel, font("bodyLight")]}>
        This part did not start.
      </Text>
      <PauseButton label="Try again" onPress={onRetry} font={font} />
    </View>
  )
}

type Stage = "waiting" | "showing" | "ended" | "failed"

type PartView = { key: string; stage: Stage; held: boolean }

function setUpPlayer(player: VideoPlayer) {
  player.timeUpdateEventInterval = PART_TICK_SECONDS
}

function readPosition(player: VideoPlayer): number {
  try {
    const seconds = player.currentTime
    return Number.isFinite(seconds) ? seconds : 0
  } catch {
    return 0 // A released player.
  }
}

function readReady(player: VideoPlayer): boolean {
  try {
    return player.status === "readyToPlay"
  } catch {
    return false
  }
}

type PartVideoProps = {
  uri: string
  range: PartRange
  active: boolean
  focused: boolean
  font: PauseFont
  onEnded: () => void
  onRetry: () => void
}

function PartVideo({
  uri,
  range,
  active,
  focused,
  font,
  onEnded,
  onRetry,
}: PartVideoProps) {
  // No session and no progress: this player is not the app's player. It holds
  // on return from the background until the viewer taps (KTD9).
  const { player } = useManagedVideoPlayer(uri, setUpPlayer, {
    holdOnReturn: true,
  })
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const frame = devotionalVideoFrame(window.width, window.height)
  const progress = useRef(new Animated.Value(0)).current
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const toggleRef = useRef<(() => void) | null>(null)
  const holdRef = useRef<(() => void) | null>(null)

  const { startSec, endSec } = range
  const key = `${startSec}-${endSec}-${active}`
  const [view, setView] = useState<PartView>({
    key,
    stage: "waiting",
    held: false,
  })
  // A new part is covered from its first render, before its effect runs.
  const current: PartView =
    view.key === key ? view : { key, stage: "waiting", held: false }

  useEffect(() => {
    const part: PartRange = { startSec, endSec }
    let disposed = false
    let ready = readReady(player)
    let stage: Stage = "waiting"
    let held = false
    let wantsPlay = false
    let waitingSince = Date.now()
    let clock = startClock(readPosition(player), Date.now(), false)
    let frameId: number | null = null
    let coverShown = false
    let coverFrameId: number | null = null

    progress.setValue(0)

    const publish = () => {
      if (!disposed) setView({ key, stage, held })
    }
    const seekToStart = () => {
      try {
        player.currentTime = part.startSec
      } catch {
        // A released player; the backstop offers "Try again".
      }
    }
    const play = () => {
      wantsPlay = true
      try {
        player.muted = false
        player.play()
      } catch {
        // A released player; the backstop offers "Try again".
      }
    }
    const pause = () => {
      try {
        player.pause()
      } catch {
        // Already released, so nothing plays.
      }
    }
    const stopFrames = () => {
      if (frameId != null) cancelAnimationFrame(frameId)
      frameId = null
    }
    const runFrames = () => {
      if (frameId == null && !disposed && active && !held) {
        frameId = requestAnimationFrame(onFrame)
      }
    }

    function stop() {
      stage = "ended"
      wantsPlay = false
      progress.setValue(1)
      publish()
      try {
        player.muted = true
      } catch {
        // Already released, so nothing sounds.
      }
      pause()
      onEndedRef.current()
    }

    function onFrame() {
      frameId = null
      if (disposed) return
      const now = Date.now()
      if (stage === "waiting") {
        const position = readPosition(player)
        if (!wantsPlay) {
          if (startGateOpen({ ready, positionSec: position, part })) play()
        } else if (partStarted(position, part)) {
          stage = "showing"
          publish()
        }
        if (stage === "waiting" && startBackstopDue(waitingSince, now)) {
          stage = "failed"
          wantsPlay = false
          pause()
          publish()
          return
        }
      }
      if (stage === "showing") {
        const projected = projectClock(clock, now)
        const time =
          watchMode(projected, part) === "frame"
            ? readPosition(player)
            : projected
        progress.setValue(partProgress(time, part))
        if (partStopDue(time, part)) {
          stop()
          return
        }
      }
      frameId = requestAnimationFrame(onFrame)
    }

    const subscriptions = [
      // The seek waits for readiness: an earlier one can be dropped.
      player.addListener("statusChange", ({ status }) => {
        if (status !== "readyToPlay" || ready) return
        ready = true
        if (coverShown) seekToStart()
        runFrames()
      }),
      player.addListener("timeUpdate", ({ currentTime }) => {
        clock = tickClock(clock, currentTime, Date.now())
      }),
      player.addListener("playingChange", ({ isPlaying }) => {
        clock = startClock(readPosition(player), Date.now(), isPlaying)
        if (isPlaying) {
          // The player went on by itself, as after a stall.
          if (held) {
            held = false
            wantsPlay = true
            publish()
            runFrames()
          }
          return
        }
        if (!wantsPlay) return
        // A pause the viewer did not cause: the background, a call, or an
        // audio interruption. It holds until a tap.
        wantsPlay = false
        held = true
        stopFrames()
        publish()
      }),
    ]

    toggleRef.current = () => {
      if (disposed || !active) return
      if (held) {
        held = false
        if (stage === "waiting") waitingSince = Date.now()
        publish()
        play()
        runFrames()
      } else if (stage === "showing" && wantsPlay) {
        wantsPlay = false
        held = true
        stopFrames()
        publish()
        pause()
      }
    }

    // A screen above the run is an interruption the player cannot see, so the
    // part holds as for a background, and only the viewer's tap resumes it.
    holdRef.current = () => {
      if (disposed || !active || held) return
      if (stage !== "waiting" && stage !== "showing") return
      wantsPlay = false
      held = true
      stopFrames()
      publish()
      pause()
    }

    // A seek flushes the frames that the player has queued, and the screen can
    // show the last of them, 0.17 s past the stop. So the seek waits two
    // frames after this commit, when the cover is on screen.
    coverFrameId = requestAnimationFrame(() => {
      coverFrameId = requestAnimationFrame(() => {
        coverFrameId = null
        coverShown = true
        if (ready) seekToStart()
      })
    })
    runFrames()

    return () => {
      disposed = true
      if (coverFrameId != null) cancelAnimationFrame(coverFrameId)
      stopFrames()
      for (const subscription of subscriptions) subscription.remove()
      toggleRef.current = null
      holdRef.current = null
      // A part can end before its stop (the developer Skip), so its sound
      // must end here too. The next part unmutes when it plays.
      try {
        player.muted = true
      } catch {
        // Already released, so nothing sounds.
      }
      pause()
    }
  }, [player, startSec, endSec, active, key, progress])

  useEffect(() => {
    if (!focused) holdRef.current?.()
  }, [focused, key])

  const { stage, held } = current
  const covered = !active || stage !== "showing"
  const tappable = active && (stage === "showing" || held)
  const videoBottom = frame.top + frame.height
  // The cue sits in the bottom letterbox, above the home indicator.
  const cueTop = Math.min(
    videoBottom,
    window.height - insets.bottom - CUE_HEIGHT,
  )

  return (
    <View
      style={styles.fill}
      pointerEvents={active ? "box-none" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    >
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        allowsVideoFrameAnalysis={false}
        // Android SurfaceView composites outside the RN tree and punches
        // through the cover drawn above it. No-op on iOS.
        surfaceType={Platform.OS === "android" ? "textureView" : undefined}
      />
      {tappable ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => toggleRef.current?.()}
          accessibilityRole="button"
          accessibilityLabel={held ? "Resume video" : "Pause video"}
        />
      ) : null}
      {covered ? (
        <View testID="part-cover" pointerEvents="none" style={styles.fill} />
      ) : null}
      {active ? (
        <PartProgressBar
          progress={progress}
          top={Math.max(0, frame.top - pauseSizes.progressBarHeight)}
        />
      ) : null}
      {active && held ? (
        <View
          testID="part-paused-cue"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.cue, { top: cueTop }]}
        >
          <Ionicons
            name="pause"
            size={CUE_GLYPH_SIZE}
            color={pauseColors.ink}
          />
          <Text style={[styles.cueLabel, font("sansMedium")]}>
            Paused · Tap to resume
          </Text>
        </View>
      ) : null}
      {active && stage === "failed" ? (
        <FailedNotice font={font} onRetry={onRetry} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: pauseColors.background,
  },
  // The letterbox matches the run's ground, so the cover reads as the frame.
  video: {
    ...StyleSheet.absoluteFill,
    backgroundColor: pauseColors.background,
  },
  cue: {
    position: "absolute",
    left: 0,
    right: 0,
    height: CUE_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  cueLabel: {
    color: pauseColors.muted,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  failed: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: pauseSpacing.screenGap,
    paddingHorizontal: pauseSpacing.screenSide,
  },
  failedLabel: {
    color: pauseColors.ink,
    fontSize: 18,
    textAlign: "center",
  },
})
