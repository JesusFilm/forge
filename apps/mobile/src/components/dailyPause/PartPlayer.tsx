// The video parts of a run (R12-R15, R24, R26). One player and one view stay
// mounted across the three parts (KTD7). Each part plays from its start and
// stops a guard length before its end behind an opaque cover, so no frame or
// sound of a skipped range reaches the screen (KTD8). Only the viewer's tap
// pauses or resumes a part, and an interruption holds it (KTD9).
import Ionicons from "@expo/vector-icons/Ionicons"
import { GlassView } from "expo-glass-effect"
import { VideoView, type VideoPlayer } from "expo-video"
import { useEffect, useRef, useState } from "react"
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { useManagedVideoPlayer } from "../../hooks/useManagedVideoPlayer"
import { hexToRgba } from "../../lib/color"
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
  pauseType,
} from "../../lib/dailyPause/theme"
import { devotionalVideoFrame } from "../../lib/dailyPause/videoFrame"
import { PartProgressBar } from "./PartProgressBar"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { PauseButton, liquidGlass } from "./PauseFrame"

/** The paused cue: a play triangle in a translucent disc over the picture. */
const CUE_SIZE = 88
const CUE_GLYPH_SIZE = 40
/** A triangle's visual center sits left of its box center. */
const CUE_GLYPH_NUDGE = 4
/** How long the cue fades out after the part resumes, in ms. */
export const CUE_FADE_MS = 250

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
      <Text style={[styles.failedLabel, pauseText(font, pauseType.message)]}>
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
  const cue = useFadeOut(active && held, key, CUE_FADE_MS)
  // The cue sits at the center of the picture, where the eye already is.
  const cueTop = frame.top + frame.height / 2 - CUE_SIZE / 2

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
      {cue.mounted ? (
        // VoiceOver reads the full-screen "Resume video" button, so the cue
        // stays hidden from it and takes only a touch. A fading cue takes none.
        <View
          // A new view for each pause: iOS keeps a faded native opacity.
          key={cue.show}
          testID={cue.leaving ? "part-paused-cue-leaving" : "part-paused-cue"}
          pointerEvents={cue.leaving ? "none" : "box-none"}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.cue, { top: cueTop }]}
        >
          <PausedCue
            leaving={cue.leaving}
            onPress={() => toggleRef.current?.()}
          />
        </View>
      ) : null}
      {active && stage === "failed" ? (
        <FailedNotice font={font} onRetry={onRetry} />
      ) : null}
    </View>
  )
}

/** A play triangle on a native Liquid Glass button where iOS has it, and on a
 *  translucent disc elsewhere. A tap on it resumes, as a tap on the picture does. */
function PausedCue({
  leaving,
  onPress,
}: {
  leaving: boolean
  onPress: () => void
}) {
  // Each pause mounts a new cue, so its value fades once and is never reset.
  const [opacity] = useState(() => new Animated.Value(1))
  useEffect(() => {
    if (!leaving) return
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: CUE_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [leaving, opacity])

  const glyph = (
    <Ionicons
      name="play"
      size={CUE_GLYPH_SIZE}
      color={pauseColors.ink}
      style={styles.cueGlyph}
    />
  )
  if (liquidGlass()) {
    // No ancestor may fade this button: GlassView draws nothing there. So the
    // glass leaves through its own native animation, and only the glyph fades.
    return (
      <Pressable onPress={onPress} accessible={false}>
        <GlassView
          testID="part-paused-cue-glass"
          style={styles.cueGlass}
          glassEffectStyle={
            leaving
              ? {
                  style: "none",
                  animate: true,
                  animationDuration: CUE_FADE_MS / 1000,
                }
              : "regular"
          }
          colorScheme="dark"
          isInteractive
        >
          <Animated.View testID="part-paused-cue-glyph" style={{ opacity }}>
            {glyph}
          </Animated.View>
        </GlassView>
      </Pressable>
    )
  }
  return (
    <Animated.View testID="part-paused-cue-fade" style={{ opacity }}>
      <Pressable
        testID="part-paused-cue-disc"
        onPress={onPress}
        accessible={false}
        style={styles.cueDisc}
      >
        {glyph}
      </Pressable>
    </Animated.View>
  )
}

type FadeState = {
  shown: boolean
  owner: string
  show: number
  leaving: boolean
}

/** `mounted` stays true for `exitMs` after `shown` turns false, and `leaving`
 *  is true for that time. `show` changes at each show. A new `owner` (another
 *  part) drops a leaving view at once, so it never fades over the next part. */
function useFadeOut(
  shown: boolean,
  owner: string,
  exitMs: number,
): { mounted: boolean; leaving: boolean; show: number } {
  const [state, setState] = useState<FadeState>({
    shown,
    owner,
    show: 0,
    leaving: false,
  })
  if (shown !== state.shown || owner !== state.owner) {
    setState({
      shown,
      owner,
      show: shown && !state.shown ? state.show + 1 : state.show,
      leaving: !shown && state.shown && owner === state.owner,
    })
  }
  useEffect(() => {
    if (!state.leaving) return
    const timer = setTimeout(
      () => setState((now) => ({ ...now, leaving: false })),
      exitMs,
    )
    return () => clearTimeout(timer)
  }, [state.leaving, state.show, exitMs])
  const leaving = !shown && state.leaving
  return { mounted: shown || leaving, leaving, show: state.show }
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
    height: CUE_SIZE,
    alignItems: "center",
  },
  cueDisc: {
    width: CUE_SIZE,
    height: CUE_SIZE,
    borderRadius: CUE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hexToRgba(pauseColors.background, 0.55),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: hexToRgba(pauseColors.ink, 0.35),
  },
  cueGlass: {
    width: CUE_SIZE,
    height: CUE_SIZE,
    borderRadius: CUE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cueGlyph: { marginLeft: CUE_GLYPH_NUDGE },
  failed: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: pauseSpacing.screenGap,
    paddingHorizontal: pauseSpacing.screenSide,
  },
  failedLabel: {
    color: pauseColors.muted,
    textAlign: "center",
  },
})
