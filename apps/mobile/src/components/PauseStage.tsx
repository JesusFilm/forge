import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { setStatusBarHidden } from "expo-status-bar"

import {
  endPause,
  liftPause,
  reportLogoDrawn,
  usePausePhase,
} from "../lib/pauseCurtain"
import { DailyBiblePauseLogo, LOGO_DURATION_MS } from "./DailyBiblePauseLogo"

/** The whole fade, from the first bar movement to a black screen. */
export const PAUSE_FADE_IN_MS = 2000
/** A full lift. A tap during the fade lifts from where the fade is now. */
export const PAUSE_FADE_OUT_MS = 1100

const VIGNETTE = ["rgba(0, 0, 0, 0.85)", "rgba(0, 0, 0, 0)"] as const

/** The bars meet at the centre at this point of the fade. */
const BAR_CLOSE_AT = 0.85
/** The logo's pen starts this long before the bars meet. */
const LOGO_LEAD_MS = 500
const LOGO_START_MS = BAR_CLOSE_AT * PAUSE_FADE_IN_MS - LOGO_LEAD_MS
const LOGO_START_AT = LOGO_START_MS / PAUSE_FADE_IN_MS
/** The pen ends this long after the curtain mounts. */
export const PAUSE_LOGO_DRAWN_MS = LOGO_START_MS + LOGO_DURATION_MS
const BAR_SAMPLES = 24
const barEase = Easing.bezier(0.42, 0, 0.58, 1)

export type PauseRun = {
  from: number
  to: number
  startedAt: number
  duration: number
}

/** Where a linear run stands at `now`. On the iPhone 17 simulator the
 *  `stopAnimation` callback never fired, so the clock is the only reading. */
export function pauseProgressAt(run: PauseRun, now: number): number {
  const elapsed = Math.min(1, Math.max(0, (now - run.startedAt) / run.duration))
  return run.from + (run.to - run.from) * elapsed
}

/** Wraps the whole app, tab bar included, and draws the Pause curtain over it.
 *  One native value runs 0 to 1, and each layer reads it through keyframes, so
 *  no nested Animated sequence can stall on Fabric. */
export function PauseStage({ children }: { children: ReactNode }) {
  const phase = usePausePhase()
  const paused = phase !== "idle"
  const progress = useRef(new Animated.Value(0)).current
  const runRef = useRef<PauseRun>({ from: 0, to: 0, startedAt: 0, duration: 1 })

  const runTo = useCallback(
    (to: number, duration: number, onDone?: () => void) => {
      const from = pauseProgressAt(runRef.current, performance.now())
      runRef.current = { from, to, startedAt: performance.now(), duration }
      // A new native animation starts from the node's live value, not `from`.
      Animated.timing(progress, {
        toValue: to,
        duration,
        // Linear on purpose: each layer's keyframes carry its own curve.
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onDone?.()
      })
    },
    [progress],
  )

  useEffect(() => {
    if (!paused) return
    setStatusBarHidden(true, "fade")
    runTo(1, PAUSE_FADE_IN_MS)
  }, [paused, runTo])

  // One lift serves a tap, Android back, and the bridge's reveal of the run.
  useEffect(() => {
    if (phase !== "lifting") return
    const at = pauseProgressAt(runRef.current, performance.now())
    setStatusBarHidden(false, "fade")
    runTo(0, Math.max(300, at * PAUSE_FADE_OUT_MS), endPause)
  }, [phase, runTo])

  useEffect(() => {
    if (!paused) return
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        liftPause()
        return true
      },
    )
    return () => subscription.remove()
  }, [paused])

  // A slow push-in with a small upward drift, like a camera dolly.
  const scale = progress.interpolate({
    inputRange: [0, 0.3, 0.85, 1],
    outputRange: [1, 1.015, 1.07, 1.08],
    extrapolate: "clamp",
  })
  const drift = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -10],
    extrapolate: "clamp",
  })

  return (
    <View style={styles.fill}>
      <Animated.View
        style={[styles.fill, { transform: [{ translateY: drift }, { scale }] }]}
      >
        {children}
      </Animated.View>
      {paused ? (
        <PauseCurtain progress={progress} onResume={liftPause} />
      ) : null}
    </View>
  )
}

function PauseCurtain({
  progress,
  onResume,
}: {
  progress: Animated.Value
  onResume: () => void
}) {
  const { width, height } = useWindowDimensions()
  // This curtain mounts on every pause, so each pause gets a new pen clock.
  const draw = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const pen = Animated.timing(draw, {
      toValue: 1,
      duration: LOGO_DURATION_MS,
      delay: LOGO_START_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    pen.start()
    // The native pen's callback is unreliable here, so a JS clock reports it.
    const drawn = setTimeout(reportLogoDrawn, PAUSE_LOGO_DRAWN_MS)
    return () => {
      pen.stop()
      clearTimeout(drawn)
    }
  }, [draw])

  const layers = useMemo(() => {
    const half = height / 2
    const at = (input: number[], output: number[]) =>
      progress.interpolate({
        inputRange: input,
        outputRange: output,
        extrapolate: "clamp",
      })
    // One ease-in-out close. Native interpolation takes no easing function,
    // so the curve is sampled into many short linear keyframes.
    const steps = Array.from(
      { length: BAR_SAMPLES + 1 },
      (_, i) => i / BAR_SAMPLES,
    )
    const barStops = steps.map((t) => t * BAR_CLOSE_AT)
    const barDepth = steps.map((t) => barEase(t) * half)
    return {
      topBar: at(
        barStops,
        barDepth.map((d) => d - half),
      ),
      bottomBar: at(
        barStops,
        barDepth.map((d) => half - d),
      ),
      vignette: at([0, 0.15, 0.35, 0.6], [0, 0, 0.5, 1]),
      // Ease-in: the image holds, then sinks fast into black.
      veil: at([0, 0.35, 0.55, 0.7, 0.82], [0, 0, 0.25, 0.6, 1]),
      // Fully shown when the pen starts; a lift fades it as the bars open.
      logo: at([0, LOGO_START_AT - 0.15, LOGO_START_AT], [0, 0, 1]),
    }
  }, [height, progress])

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={onResume}
      accessibilityRole="button"
      accessibilityLabel="Daily Bible Pause. Tap to return."
      accessibilityViewIsModal
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: layers.vignette }]}
      >
        <LinearGradient
          colors={VIGNETTE}
          style={[styles.edge, { top: 0, height: height * 0.35 }]}
        />
        <LinearGradient
          colors={VIGNETTE}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={[styles.edge, { bottom: 0, height: height * 0.35 }]}
        />
        <LinearGradient
          colors={VIGNETTE}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.side, { left: 0, width: width * 0.35 }]}
        />
        <LinearGradient
          colors={VIGNETTE}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={[styles.side, { right: 0, width: width * 0.35 }]}
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.black,
          StyleSheet.absoluteFill,
          { opacity: layers.veil },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.bar,
          { top: 0, height: height / 2 + 1 },
          { transform: [{ translateY: layers.topBar }] },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.bar,
          { bottom: 0, height: height / 2 + 1 },
          { transform: [{ translateY: layers.bottomBar }] },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.centre, { opacity: layers.logo }]}
      >
        <DailyBiblePauseLogo draw={draw} />
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  black: { backgroundColor: "#000000" },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "#000000",
  },
  edge: { position: "absolute", left: 0, right: 0 },
  side: { position: "absolute", top: 0, bottom: 0 },
  centre: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
})
