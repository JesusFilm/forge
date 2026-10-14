// The video parts of a run (R12-R15, R24, R26), on one player that stays
// mounted (KTD7). A part stops a guard length before its end, so nothing of a
// skipped range shows (KTD8). Only a tap resumes a held part (KTD9).
import Ionicons from "@expo/vector-icons/Ionicons"
import { GlassView } from "expo-glass-effect"
import { LinearGradient } from "expo-linear-gradient"
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
  partStopAt,
  partTimeAt,
  tickClock,
  watchMode,
} from "../../lib/dailyPause/partClock"
import {
  PART_FAST_HOLD_MS,
  PART_FAST_RATE,
  onFastSide,
} from "../../lib/dailyPause/partGestures"
import {
  pauseColors,
  pauseSpacing,
  pauseType,
} from "../../lib/dailyPause/theme"
import { DIP_TIMINGS } from "../../lib/dailyPause/stepDip"
import { PartProgressBar } from "./PartProgressBar"
import { pauseText, type PauseFont } from "../../lib/dailyPause/fonts"
import { PauseButton, liquidGlass } from "./PauseFrame"
import { useFadeOut } from "./useFadeOut"
import { useRunVideoLayout } from "./useTopRowTop"
import { RUN_TOP_ROW_HEIGHT } from "../../lib/dailyPause/videoFrame"

/** The paused cue: a play triangle in a translucent disc over the picture. */
const CUE_SIZE = 88
const CUE_GLYPH_SIZE = 40
/** A triangle's visual center sits left of its box center. */
const CUE_GLYPH_NUDGE = 4
/** How long the cue fades in as the part pauses, and out as it resumes, in ms. */
export const CUE_FADE_MS = 250
/** The 2x label sits this far below the marker row. */
const FAST_CUE_GAP = 8
/** The picture's top and bottom edges fade into the run's ground (the owner,
 *  2026-10-14), so neither edge shows. The bar sits on the bottom fade, and
 *  the captions stay in the clear middle. */
const EDGE_FADE_HEIGHT = 140
/** The top fade runs from the screen's edge, under the status bar, to this far
 *  below the marker row. The markers and the clock then read on any frame. */
const TOP_FADE_TAIL = 36
const TOP_FADE_COLORS = [
  pauseColors.background,
  hexToRgba(pauseColors.background, 0.55),
  hexToRgba(pauseColors.background, 0),
] as const
const TOP_FADE_LOCATIONS = [0, 0.5, 1] as const
const BOTTOM_FADE_COLORS = [
  hexToRgba(pauseColors.background, 0),
  hexToRgba(pauseColors.background, 0.4),
  pauseColors.background,
] as const
const BOTTOM_FADE_LOCATIONS = [0, 0.45, 1] as const
const FAST_GLYPH_SIZE = 14
/** A part fades in from its cover as it starts, in ms. The lift starts only
 *  when the part shows, after its seek, so it is shorter than the dip's fade-in. */
export const COVER_LIFT_MS = 450
/** A part that stops fades to its cover with the step dip's fade-out, in ms. */
export const COVER_SETTLE_MS = DIP_TIMINGS.flow.outMs

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

type PartView = { key: string; stage: Stage; held: boolean; fast: boolean }

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

function readPlaying(player: VideoPlayer): boolean {
  try {
    return player.playing
  } catch {
    return false
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
  const layout = useRunVideoLayout()
  const { frame } = layout
  const progress = useRef(new Animated.Value(0)).current
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const toggleRef = useRef<(() => void) | null>(null)
  const holdRef = useRef<(() => void) | null>(null)
  /** Seeks to a 0..1 place on the bar, while the part shows. */
  const seekRef = useRef<((fraction: number) => void) | null>(null)
  /** Starts or ends the 2x play; true when the rate changed. */
  const fastRef = useRef<((on: boolean) => boolean) | null>(null)
  /** A drag on the bar starts, and ends at a 0..1 place or with null. */
  const scrubStartRef = useRef<(() => void) | null>(null)
  const scrubEndRef = useRef<((fraction: number | null) => void) | null>(null)
  // While a finger drags the bar, the bar alone writes `progress`.
  const scrubbing = useRef(false)

  const { startSec, endSec } = range
  const key = `${startSec}-${endSec}-${active}`
  const [view, setView] = useState<PartView>({
    key,
    stage: "waiting",
    held: false,
    fast: false,
  })
  // A new part is covered from its first render, before its effect runs.
  const current: PartView =
    view.key === key
      ? view
      : { key, stage: "waiting", held: false, fast: false }

  useEffect(() => {
    const part: PartRange = { startSec, endSec }
    let disposed = false
    let ready = readReady(player)
    let stage: Stage = "waiting"
    let held = false
    let wantsPlay = false
    let waitingSince = Date.now()
    let rate = 1
    let clock = startClock(readPosition(player), Date.now(), false)
    // The stop came under a dragging finger: the part waits there, paused and
    // silent, and the release decides, as on Explore's clips.
    let parked = false
    let scrubbedHere = false
    let frameId: number | null = null
    let coverShown = false
    let coverFrameId: number | null = null

    progress.setValue(0)

    const publish = () => {
      if (!disposed) setView({ key, stage, held, fast: rate !== 1 })
    }
    const writeRate = (next: number) => {
      try {
        player.playbackRate = next
      } catch {
        // A released player plays nothing.
      }
    }
    // iOS starts a paused player when its rate is written, so a paused player
    // takes a new rate only when it next plays.
    const setRate = (next: number) => {
      rate = next
      if (readPlaying(player)) writeRate(next)
      clock = startClock(readPosition(player), Date.now(), clock.running, next)
    }
    // Every way out of playing ends the 2x play; the caller publishes.
    const endFast = () => {
      if (rate !== 1) setRate(1)
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
        // A pause can leave the native rate at 2x, and play() uses it.
        player.playbackRate = rate
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
      endFast()
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

    function park() {
      parked = true
      wantsPlay = false
      endFast()
      try {
        player.muted = true
      } catch {
        // Already released, so nothing sounds.
      }
      pause()
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
        if (!scrubbing.current) progress.setValue(partProgress(time, part))
        if (partStopDue(time, part)) {
          if (scrubbing.current) park()
          else stop()
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
        clock = startClock(readPosition(player), Date.now(), isPlaying, rate)
        if (isPlaying) {
          // A rate kept back while the player was paused applies now.
          try {
            if (player.playbackRate !== rate) writeRate(rate)
          } catch {
            // A released player plays nothing.
          }
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
        endFast()
        stopFrames()
        publish()
      }),
    ]

    toggleRef.current = () => {
      if (disposed || !active) return
      if (held) {
        held = false
        // A part held at its stop ends on the tap. A play from there would
        // sound past the stop (KTD8).
        if (parked) {
          parked = false
          stop()
          return
        }
        if (stage === "waiting") waitingSince = Date.now()
        publish()
        play()
        runFrames()
      } else if (stage === "showing" && wantsPlay) {
        wantsPlay = false
        held = true
        endFast()
        stopFrames()
        publish()
        pause()
      }
    }

    // A seek stays inside the part. A seek to its stop ends the part, as if
    // it had played out, so no frame of the range after it shows (KTD8).
    const seekTo = (fraction: number) => {
      if (disposed || !active || stage !== "showing") return
      const target = partTimeAt(fraction, part)
      if (target >= partStopAt(part)) {
        stop()
        return
      }
      try {
        player.currentTime = target
      } catch {
        return // A released player.
      }
      clock = startClock(target, Date.now(), clock.running, rate)
      progress.setValue(partProgress(target, part))
      if (parked) {
        parked = false
        // A hold that came during the drag keeps the part held (KTD9).
        if (!held) {
          play()
          runFrames()
        }
      }
    }
    seekRef.current = seekTo

    scrubStartRef.current = () => {
      scrubbing.current = true
      scrubbedHere = true
    }
    scrubEndRef.current = (fraction) => {
      scrubbing.current = false
      // A drag that began over another part never seeks this one.
      if (!scrubbedHere) return
      scrubbedHere = false
      if (fraction != null) seekTo(fraction)
      else if (parked) {
        // The system took the drag (Home, a lock, a call), so the part holds
        // at its stop. Nothing plays until the viewer taps (KTD9).
        held = true
        publish()
      } else progress.setValue(partProgress(readPosition(player), part))
    }

    fastRef.current = (on) => {
      if (disposed || !active) return false
      if (!on) {
        if (rate === 1) return false
        setRate(1)
        publish()
        return true
      }
      if (stage !== "showing" || held || !wantsPlay || rate !== 1) return false
      setRate(PART_FAST_RATE)
      publish()
      return true
    }

    // A screen above the run is an interruption the player cannot see, so the
    // part holds as for a background, and only the viewer's tap resumes it.
    holdRef.current = () => {
      if (disposed || !active || held) return
      if (stage !== "waiting" && stage !== "showing") return
      wantsPlay = false
      held = true
      endFast()
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
      seekRef.current = null
      fastRef.current = null
      scrubStartRef.current = null
      scrubEndRef.current = null
      scrubbing.current = false
      // Only while it plays: on iOS a rate write starts a paused player. The
      // next part's play() sets the rate in any case.
      if (rate !== 1 && readPlaying(player)) writeRate(1)
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

  const { stage, held, fast } = current
  const covered = !active || stage !== "showing"
  // The last part that showed. A cover over that part settles over its still
  // frame; a new part's cover is opaque from its first render, before a seek.
  const shownKey = useRef<string | null>(null)
  useEffect(() => {
    if (stage === "showing") shownKey.current = key
  }, [stage, key])
  const coverView = useFadeOut(covered, key, COVER_LIFT_MS)
  const tappable = active && (stage === "showing" || held)
  // A press on a side that lasts plays at 2x until it lifts. A long press in
  // the middle, or on a side while held, works as a tap when it lifts.
  const pressOnSide = useRef(false)
  const longPress = useRef<"none" | "fast" | "tap">("none")
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
        style={[
          styles.video,
          {
            top: frame.top,
            left: frame.left,
            width: frame.width,
            height: frame.height,
          },
        ]}
        contentFit="contain"
        nativeControls={false}
        allowsVideoFrameAnalysis={false}
        // Android SurfaceView composites outside the RN tree and punches
        // through the cover drawn above it. No-op on iOS.
        surfaceType={Platform.OS === "android" ? "textureView" : undefined}
      />
      {active ? (
        <LinearGradient
          testID="part-top-fade"
          pointerEvents="none"
          colors={TOP_FADE_COLORS}
          locations={TOP_FADE_LOCATIONS}
          style={[
            styles.shade,
            {
              top: frame.top,
              left: frame.left,
              width: frame.width,
              height:
                layout.rowTop + RUN_TOP_ROW_HEIGHT + TOP_FADE_TAIL - frame.top,
            },
          ]}
        />
      ) : null}
      {active ? (
        <LinearGradient
          testID="part-bottom-fade"
          pointerEvents="none"
          colors={BOTTOM_FADE_COLORS}
          locations={BOTTOM_FADE_LOCATIONS}
          style={[
            styles.shade,
            {
              top: frame.top + frame.height - EDGE_FADE_HEIGHT,
              left: frame.left,
              width: frame.width,
              height: EDGE_FADE_HEIGHT,
            },
          ]}
        />
      ) : null}
      {tappable ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          delayLongPress={PART_FAST_HOLD_MS}
          onPressIn={(e) => {
            longPress.current = "none"
            pressOnSide.current = onFastSide(e.nativeEvent.pageX, window.width)
          }}
          onLongPress={() => {
            longPress.current =
              pressOnSide.current && fastRef.current?.(true) ? "fast" : "tap"
          }}
          onPressOut={() => {
            const was = longPress.current
            longPress.current = "none"
            if (was === "fast") fastRef.current?.(false)
            else if (was === "tap") toggleRef.current?.()
          }}
          onPress={() => toggleRef.current?.()}
          accessibilityRole="button"
          accessibilityLabel={held ? "Resume video" : "Pause video"}
        />
      ) : null}
      {coverView.mounted ? (
        <PartCover
          // A new part gets a new, opaque cover, even while the last settles.
          key={`${key}:${coverView.show}`}
          leaving={coverView.leaving}
          settles={shownKey.current === key}
        />
      ) : null}
      {active && fast ? (
        <View
          testID="part-fast-cue"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.fastCue,
            { top: layout.rowTop + RUN_TOP_ROW_HEIGHT + FAST_CUE_GAP },
          ]}
        >
          <View style={styles.fastPill}>
            <Text style={[styles.fastLabel, font("sansSemiBold")]}>2×</Text>
            <Ionicons
              name="play-forward"
              size={FAST_GLYPH_SIZE}
              color={pauseColors.white}
            />
          </View>
        </View>
      ) : null}
      {active ? (
        <PartProgressBar
          // A part change drops a drag that began over the last part.
          key={key}
          progress={progress}
          top={layout.barTop}
          lengthSec={partStopAt(range) - range.startSec}
          enabled={stage === "showing"}
          onScrubStart={() => scrubStartRef.current?.()}
          onScrubEnd={(fraction) => scrubEndRef.current?.(fraction)}
          onSeek={(fraction) => seekRef.current?.(fraction)}
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

/** The ground over the picture while a part is not showing. It lifts as the
 *  part starts, and settles over a part that stops, so neither cuts. */
function PartCover({
  leaving,
  settles,
}: {
  leaving: boolean
  settles: boolean
}) {
  // The prop changes after the part shows, so it is read once. A later read
  // would start a settle over a lift that is still running.
  const [settle] = useState(settles)
  // Each cover is a new view with its own value. iOS keeps a faded native
  // opacity, and a reset of a shared value lands a frame late.
  const [opacity] = useState(() => new Animated.Value(settle ? 0 : 1))
  useEffect(() => {
    if (!settle) return
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: COVER_SETTLE_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [settle, opacity])
  useEffect(() => {
    if (!leaving) return
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: COVER_LIFT_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [leaving, opacity])
  return (
    <Animated.View
      testID={leaving ? "part-cover-leaving" : "part-cover"}
      pointerEvents="none"
      style={[styles.fill, { opacity }]}
    />
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
  // Each pause mounts a new cue, so its value fades in once and out once, and
  // is never reset. It fades in as it fades out (the owner, 2026-10-14).
  const [opacity] = useState(() => new Animated.Value(0))
  // The cue mounts unseen, and the fade starts two frames later: iOS animates
  // no glass change in the frame that first draws the glass.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntered(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const shown = entered && !leaving
  useEffect(() => {
    if (!entered) return
    const animation = Animated.timing(opacity, {
      toValue: shown ? 1 : 0,
      duration: CUE_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [entered, shown, opacity])

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
    // glass comes and goes through its own native animation, and only the
    // glyph fades.
    return (
      <Pressable onPress={onPress} accessible={false}>
        <GlassView
          testID="part-paused-cue-glass"
          style={styles.cueGlass}
          glassEffectStyle={{
            style: shown ? "regular" : "none",
            animate: true,
            animationDuration: CUE_FADE_MS / 1000,
          }}
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

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: pauseColors.background,
  },
  // The picture's own box, from the safe area down. The bands around it
  // match the run's ground, so the cover reads as the frame.
  video: {
    position: "absolute",
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
  // The top and bottom edge fades.
  shade: { position: "absolute" },
  fastCue: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  fastPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: hexToRgba(pauseColors.background, 0.6),
  },
  fastLabel: { color: pauseColors.white, fontSize: 14 },
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
