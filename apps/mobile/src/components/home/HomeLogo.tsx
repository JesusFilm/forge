import { useEffect, useRef } from "react"
import { Animated, Easing, StyleSheet } from "react-native"
import { Image } from "expo-image"

import jfpMark from "../../../assets/splash-mark-crimson.png"
import { useReduceMotion } from "../../hooks/useReduceMotion"
import { HORIZONTAL_PADDING } from "../../styles/shared"
import {
  HOME_HEADER_ROW_HEIGHT,
  HOME_HEADER_ROW_TOP,
} from "../ui/homeHeaderLayout"

// The raster is the JFP symbol cropped to its own bounds (1024 x 748).
const MARK_ASPECT = 1024 / 748
export const HOME_LOGO_WIDTH = 36
export const HOME_LOGO_HEIGHT = Math.round(HOME_LOGO_WIDTH / MARK_ASPECT)

export const HOME_LOGO_EXIT_MS = 220
export const HOME_LOGO_ENTER_MS = 280
// Extra travel past the screen's top edge, so no sliver of the logo stays.
const EXIT_MARGIN = 8

/**
 * The logo's top, centred on HomeHeader's row. Rounded, because Android blurs
 * sub-pixel positions.
 */
export function homeLogoTop(topInset: number): number {
  return Math.round(
    topInset +
      HOME_HEADER_ROW_TOP +
      (HOME_HEADER_ROW_HEIGHT - HOME_LOGO_HEIGHT) / 2,
  )
}

/** The translateY that puts the whole logo above the screen's top edge. */
export function homeLogoExitOffset(topInset: number): number {
  return -(homeLogoTop(topInset) + HOME_LOGO_HEIGHT + EXIT_MARGIN)
}

type HomeLogoProps = {
  topInset: number
  hidden: boolean
}

/**
 * The JFP symbol in Home's top-left corner, on its own layer above the feed.
 * A scroll only sets `hidden`; the logo then slides on its own timing, so it
 * never looks like part of the scrolling content.
 */
export function HomeLogo({ topInset, hidden }: HomeLogoProps) {
  const reduceMotion = useReduceMotion()
  const target = hidden ? homeLogoExitOffset(topInset) : 0
  // Starts on its target: a mount must not replay the slide.
  const translateY = useRef(new Animated.Value(target)).current
  const targetRef = useRef(target)

  useEffect(() => {
    if (targetRef.current === target) return
    targetRef.current = target
    Animated.timing(translateY, {
      toValue: target,
      // Reduce Motion keeps the exit and the return, but drops the slide.
      duration: reduceMotion
        ? 0
        : hidden
          ? HOME_LOGO_EXIT_MS
          : HOME_LOGO_ENTER_MS,
      // Leaves accelerating, returns decelerating.
      easing: hidden ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [target, hidden, reduceMotion, translateY])

  return (
    <Animated.View
      testID="home-logo-layer"
      pointerEvents="none"
      // Off the screen, the logo must leave the screen reader's order too.
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      style={[
        styles.layer,
        { top: homeLogoTop(topInset), transform: [{ translateY }] },
      ]}
    >
      <Image
        testID="home-logo"
        // Static key: Home mounts one logo and never recycles it.
        recyclingKey="home-logo"
        source={jfpMark}
        contentFit="contain"
        accessible
        accessibilityLabel="Jesus Film Project"
        style={styles.logo}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: HORIZONTAL_PADDING,
    // Above HomeHeader (10), so its status-bar gradient does not dim the logo.
    zIndex: 11,
  },
  logo: {
    width: HOME_LOGO_WIDTH,
    height: HOME_LOGO_HEIGHT,
  },
})
