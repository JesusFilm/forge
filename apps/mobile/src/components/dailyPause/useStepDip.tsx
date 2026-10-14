import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Animated, Easing, StyleSheet } from "react-native"

import {
  dipOpacityRange,
  dipTiming,
  type DipKind,
  type DipTiming,
} from "../../lib/dailyPause/stepDip"
import { pauseColors } from "../../lib/dailyPause/theme"

/** The JS clock takes the veil away this long after its native fade ends, so
 *  the veil never unmounts while it still shows. */
export const DIP_END_MARGIN_MS = 100

type Dip = {
  id: number
  timing: DipTiming
  change: () => void
  progress: Animated.Value
}

/** The dip between two steps of the run. `dip` fades the run to its ground,
 *  makes the change while all is dark, and fades the next step in. A change
 *  asked for during a dip is dropped: the dip's own change wins. */
export function useStepDip(reduceMotion: boolean): {
  dip: (change: () => void, kind?: DipKind) => void
  veil: ReactNode
} {
  const [current, setCurrent] = useState<Dip | null>(null)
  const busy = useRef(false)
  const nextId = useRef(0)
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion

  const dip = useCallback((change: () => void, kind: DipKind = "flow") => {
    if (busy.current) return
    busy.current = true
    nextId.current += 1
    setCurrent({
      id: nextId.current,
      timing: dipTiming(kind, reduceMotionRef.current),
      change,
      // A new value for each dip: a reset of a shared one lands a frame late.
      progress: new Animated.Value(0),
    })
  }, [])

  const end = useCallback(() => {
    busy.current = false
    setCurrent(null)
  }, [])

  const veil = current ? (
    <DipVeil key={current.id} dip={current} onEnd={end} />
  ) : null
  return { dip, veil }
}

function DipVeil({ dip, onEnd }: { dip: Dip; onEnd: () => void }) {
  const { progress, timing, change } = dip

  // Start after mount, so the native node drives a view that exists. The JS
  // clock makes the change and the end; no native callback is waited for.
  useEffect(() => {
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: timing.totalMs,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    run.start()
    const swap = setTimeout(change, timing.swapMs)
    const done = setTimeout(onEnd, timing.totalMs + DIP_END_MARGIN_MS)
    return () => {
      run.stop()
      clearTimeout(swap)
      clearTimeout(done)
    }
  }, [progress, timing, change, onEnd])

  const opacity = useMemo(
    () => progress.interpolate(dipOpacityRange(timing)),
    [progress, timing],
  )

  return (
    <Animated.View
      testID="pause-step-dip"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.veil, { opacity }]}
    />
  )
}

const styles = StyleSheet.create({
  veil: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: pauseColors.background,
  },
})
