import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ComponentProps } from "react"
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { useTypography } from "../../hooks/useTypography"
import { TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { canUseLiquidGlass } from "../../lib/liquidGlass"
import { useTabBarClearance } from "../../lib/tabBar"
import { GlassSurface, type GlassFallback } from "./GlassSurface"

type SnackbarProps = {
  message: string
  visible: boolean
  onDismiss: () => void
  duration?: number
  /** Lift clear of the floating iOS tab bar. Only the tab routes have one. */
  clearsTabBar?: boolean
  /** The leading glyph. The default reads as success, which not every message
   *  is. */
  iconName?: ComponentProps<typeof Ionicons>["name"]
  iconColor?: string
  /** Replaces the computed lift entirely. A host mounted at the ROOT sits
   *  outside the tab controller, so `useTabBarClearance` is wrong there. */
  bottomOffset?: number
}

/** The glass slide for one showing: a fresh value, and the measured height. */
type GlassSlide = { value: Animated.Value; height: number }

const ENTER_SPRING = { tension: 80, friction: 10 }
const EXIT_MS = 250

export function Snackbar({
  message,
  visible,
  onDismiss,
  duration = 3000,
  clearsTabBar = false,
  iconName = "checkmark-circle",
  iconColor = "#4ade80",
  bottomOffset,
}: SnackbarProps) {
  const insets = useSafeAreaInsets()
  const tabBarClearance = useTabBarClearance()
  // The clearance already carries insets.bottom, so the two terms are exclusive.
  // It is 0 on Android, where the bar displaces content instead of floating over
  // it, and that path must keep the plain inset it has always used.
  const liftsOverBar = clearsTabBar && tabBarClearance > 0
  const typography = useTypography()
  const glass = canUseLiquidGlass()
  const reduceMotion = useReduceMotion()
  const windowHeight = useWindowDimensions().height
  // The fallback's motion, unchanged: a 100pt slide under a fade.
  const translateY = useRef(new Animated.Value(100)).current
  const opacity = useRef(new Animated.Value(0)).current
  const [slide, setSlide] = useState<GlassSlide | null>(null)
  const [mounted, setMounted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissRef = useRef<() => void>(() => {})

  // One named value, named as `ExportReportHost` names the same quantity, so
  // the applied lift stays on one line: the caller's own offset wins, else the
  // tab-bar clearance, else the safe area.
  const clearance =
    bottomOffset ?? (liftsOverBar ? tabBarClearance : insets.bottom) + 16

  useEffect(() => {
    if (visible) {
      setMounted(true)
      // Glass waits for the height (`handleLayout`), so it starts off screen.
      if (!glass) {
        Animated.parallel([
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            ...ENTER_SPRING,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start()
      }
      timer.current = setTimeout(() => {
        dismissRef.current()
      }, duration)
    }
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [visible])

  const slideValue = slide?.value
  useEffect(() => {
    if (slideValue == null || reduceMotion) return
    Animated.spring(slideValue, {
      toValue: 0,
      useNativeDriver: true,
      ...ENTER_SPRING,
    }).start()
  }, [slideValue])

  const dismiss = () => {
    if (!glass) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 100,
          duration: EXIT_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: EXIT_MS,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setMounted(false)
          onDismiss()
        }
      })
      return
    }
    const finish = () => {
      setMounted(false)
      setSlide(null)
      onDismiss()
    }
    if (slide == null || reduceMotion) {
      finish()
      return
    }
    // R10: no fade on glass, so it leaves by its whole height past the edge.
    Animated.timing(slide.value, {
      toValue: clearance + slide.height,
      duration: EXIT_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) finish()
    })
  }
  // The auto-dismiss timer starts at show time, but the glass exit reads the
  // height measured after it.
  useLayoutEffect(() => {
    dismissRef.current = dismiss
  })

  const handleLayout = (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout
    if (slide == null) {
      // A fresh value per showing: a reset of a native-driven value reaches
      // the native side a frame late.
      const start = reduceMotion ? 0 : clearance + height
      setSlide({ value: new Animated.Value(start), height })
    } else if (slide.height !== height) {
      setSlide({ value: slide.value, height })
    }
  }

  if (!mounted) return null

  // Until the height is known, the window height keeps any snackbar that fits
  // on screen fully below the edge.
  const motion = glass
    ? { transform: [{ translateY: slide?.value ?? windowHeight }] }
    : { transform: [{ translateY }] }

  return (
    <Animated.View
      onLayout={glass ? handleLayout : undefined}
      style={[styles.position, { bottom: clearance }, motion]}
    >
      <GlassSurface
        style={styles.container}
        fallback={SOLID_CARD}
        fade={glass ? undefined : opacity}
      >
        <Ionicons name={iconName} size={22} color={iconColor} />
        <Text style={[styles.message, typography.body]}>{message}</Text>
        <Pressable onPress={dismiss} hitSlop={8}>
          <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
        </Pressable>
      </GlassSurface>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  position: {
    position: "absolute",
    left: 16,
    right: 16,
  },
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  card: {
    backgroundColor: "#292524",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  message: {
    flex: 1,
    color: TEXT_PRIMARY,
  },
})

// The solid card wherever Liquid Glass is unavailable.
const SOLID_CARD: GlassFallback = { kind: "fill", style: styles.card }
