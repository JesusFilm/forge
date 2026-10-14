import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  AppState,
  Easing,
  Platform,
  StyleSheet,
  type AppStateStatus,
} from "react-native"
import { Image } from "expo-image"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import {
  LIGHT_LEAK_CROSSFADE,
  LIGHT_LEAK_CURVE,
  LIGHT_LEAK_FLASH_MS,
  lightLeakGapMs,
  lightLeaksSupported,
  pickLightLeakShape,
  type LightLeakShape,
} from "../../lib/dailyPause/lightLeaks"

/* eslint-disable @typescript-eslint/no-require-imports */
/** Two frames of each filmed leak, from scripts/build-pause-light-leaks.sh. */
export const LEAK_PLATES = {
  sweep: [
    require("../../../assets/dailyPause/leaks/sweep-a.jpg"),
    require("../../../assets/dailyPause/leaks/sweep-b.jpg"),
  ],
  band: [
    require("../../../assets/dailyPause/leaks/band-a.jpg"),
    require("../../../assets/dailyPause/leaks/band-b.jpg"),
  ],
} as const satisfies Record<string, readonly [number, number]>
/* eslint-enable @typescript-eslint/no-require-imports */

type LeakFilm = keyof typeof LEAK_PLATES

const LOOKS: Record<LightLeakShape, { film: LeakFilm; mirrored: boolean }> = {
  sweep: { film: "sweep", mirrored: false },
  band: { film: "band", mirrored: false },
  "sweep-left": { film: "sweep", mirrored: true },
  "band-left": { film: "band", mirrored: true },
}

/** The opacity at the top of the flash. */
const LEAK_PEAK = 0.85

/** The leak's black is no light: a screen blend adds only the bright part. */
const SUPPORTED = lightLeaksSupported(Platform.OS, Platform.Version)

type Flash = { id: number; shape: LightLeakShape; progress: Animated.Value }

/** Film light leaks that flash over the Home Pause card from time to time.
 *  They rest while `enabled` is false, in the background, with Reduce Motion
 *  on, and on Android 9 and older. */
export function PauseLightLeaks({ enabled }: { enabled: boolean }) {
  const reduceMotion = useReduceMotion()
  const foreground = useForeground()
  const running = SUPPORTED && enabled && foreground && !reduceMotion

  const [flash, setFlash] = useState<Flash | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runningRef = useRef(false)
  const lastShape = useRef<LightLeakShape | null>(null)
  const nextId = useRef(0)

  const schedule = useCallback(() => {
    timer.current = setTimeout(() => {
      timer.current = null
      const shape = pickLightLeakShape(lastShape.current)
      lastShape.current = shape
      nextId.current += 1
      // A new value for each flash: a reset of a shared one lands a frame late.
      setFlash({ id: nextId.current, shape, progress: new Animated.Value(0) })
    }, lightLeakGapMs())
  }, [])

  useEffect(() => {
    if (!running) return
    runningRef.current = true
    schedule()
    return () => {
      runningRef.current = false
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      setFlash(null)
    }
  }, [running, schedule])

  const handleDone = useCallback(() => {
    setFlash(null)
    // A finish that arrives after a stop must not start the next gap.
    if (runningRef.current) schedule()
  }, [schedule])

  if (!flash) return null
  return (
    <LightLeak
      key={flash.id}
      shape={flash.shape}
      progress={flash.progress}
      onDone={handleDone}
    />
  )
}

function LightLeak({
  shape,
  progress,
  onDone,
}: {
  shape: LightLeakShape
  progress: Animated.Value
  onDone: () => void
}) {
  const look = LOOKS[shape]
  const plates = LEAK_PLATES[look.film]

  // Start after mount, so the native node drives a view that exists.
  useEffect(() => {
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: LIGHT_LEAK_FLASH_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    run.start(({ finished }) => {
      if (finished) onDone()
    })
    return () => run.stop()
  }, [progress, onDone])

  const motion = useMemo(
    () => ({
      opacity: progress.interpolate({
        inputRange: [...LIGHT_LEAK_CURVE.inputRange],
        outputRange: LIGHT_LEAK_CURVE.outputRange.map((v) => v * LEAK_PEAK),
      }),
      // A slow push across the card, like light that moves past the lens.
      transform: [
        { scaleX: look.mirrored ? -1 : 1 },
        {
          translateX: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [-14, 14],
          }),
        },
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [1.08, 1.16],
          }),
        },
      ],
    }),
    [progress, look],
  )
  const secondOpacity = useMemo(
    () =>
      progress.interpolate({
        inputRange: [...LIGHT_LEAK_CROSSFADE.inputRange],
        outputRange: [...LIGHT_LEAK_CROSSFADE.outputRange],
        extrapolate: "clamp",
      }),
    [progress],
  )

  return (
    <Animated.View
      testID="pause-light-leak"
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      // Android fades a group child by child unless it is drawn offscreen.
      needsOffscreenAlphaCompositing
      style={[styles.leak, motion]}
    >
      <Image
        source={plates[0]}
        recyclingKey={`leak-${look.film}-0`}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        accessible={false}
      />
      <Animated.View
        testID="pause-light-leak-second"
        style={[StyleSheet.absoluteFill, { opacity: secondOpacity }]}
      >
        <Image
          source={plates[1]}
          recyclingKey={`leak-${look.film}-1`}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessible={false}
        />
      </Animated.View>
    </Animated.View>
  )
}

/** iOS can report "unknown" before its first change, so only the two
 *  resting states count as away. */
function isForeground(state: AppStateStatus): boolean {
  return state !== "background" && state !== "inactive"
}

function useForeground(): boolean {
  const [foreground, setForeground] = useState(() =>
    isForeground(AppState.currentState),
  )
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(isForeground(state)),
    )
    return () => subscription.remove()
  }, [])
  return foreground
}

const styles = StyleSheet.create({
  leak: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    mixBlendMode: "screen",
  },
})
