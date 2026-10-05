import { useCallback, useEffect, useRef, useState } from "react"
import { Animated, Easing, type LayoutChangeEvent } from "react-native"

// The scrim FADES while the panel SLIDES. RN's Modal `animationType="slide"`
// would translate the scrim with the panel, so each sheet owns both.
export const SLIDE_UP_SHEET_ENTER_MS = 240
export const SLIDE_UP_SHEET_EXIT_MS = 180

export type SlideUpSheet = {
  /** 0 = dismissed, 1 = presented. One clock for the scrim and the panel. */
  progress: Animated.Value
  /** Measured panel height; the panel stays parked offscreen until it lands. */
  panelHeight: number
  onPanelLayout: (event: LayoutChangeEvent) => void
  /** Runs the exit, then fires `onClose` once. Repeat calls are no-ops. */
  close: () => void
}

/** Enter/exit mechanism shared by the component-state Modal sheets
 * (`PlayerSettingsSheet`, `FeedbackModal`). The host unmounts on `onClose`. */
export function useSlideUpSheet(
  onClose: () => void,
  { reduceMotion = false }: { reduceMotion?: boolean } = {},
): SlideUpSheet {
  const progress = useRef(new Animated.Value(0)).current
  const [panelHeight, setPanelHeight] = useState(0)
  const closingRef = useRef(false)

  // The panel's offset is in points, so animating before the layout lands
  // would slide it the wrong distance.
  useEffect(() => {
    if (panelHeight === 0 || closingRef.current) return
    Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : SLIDE_UP_SHEET_ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [panelHeight, progress, reduceMotion])

  // A timer fires onClose, never the animation callback: a native-driver
  // completion never arrives under jest, and an interrupted animation would
  // otherwise strand the sheet open.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    const exitMs = reduceMotion ? 0 : SLIDE_UP_SHEET_EXIT_MS
    Animated.timing(progress, {
      toValue: 0,
      duration: exitMs,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start()
    closeTimerRef.current = setTimeout(onClose, exitMs)
  }, [onClose, progress, reduceMotion])

  // An unmount from another path (route pop, player handover) would otherwise
  // fire onClose into a torn-down tree.
  useEffect(
    () => () => {
      if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current)
    },
    [],
  )

  const onPanelLayout = useCallback((event: LayoutChangeEvent) => {
    setPanelHeight(event.nativeEvent.layout.height)
  }, [])

  return { progress, panelHeight, onPanelLayout, close }
}
