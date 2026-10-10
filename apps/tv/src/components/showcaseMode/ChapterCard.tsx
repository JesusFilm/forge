/**
 * R8's chapter card: the felt need, full screen, for about five seconds before the
 * chapter's excerpts play. Presentation only — the reducer owns whether it shows at
 * all (a fallback reel carries no felt-need labels and never enters this phase).
 */

import { useEffect, useRef } from "react"
import { Animated, Easing, StyleSheet, Text, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { scale } from "../../lib/scale"
import {
  CHAPTER_CARD_DURATION_MS,
  OVERLAY_CROSSFADE_MS,
  OVERLAY_EXIT_MARGIN_MS,
} from "../../lib/showcaseMode/reelState"
import { WATCH_THEME } from "../watch/watchDetailTheme"

const ENTER_MS = 420
const RISE_DISTANCE = scale(18)

const DOT_RESTING = "rgba(255,255,255,0.22)"

export type ChapterCardProps = {
  /** The felt-need name (the chapter's resolved title). */
  title: string
  subtitle: string | null
  /** 1-based position among the chapters that actually play — see `total`. */
  position: number
  /**
   * How many chapters the reel really plays. The reducer skips excerpt-less chapters
   * at runtime, so counting the raw queue would show dots the viewer never reaches.
   */
  total: number
  /**
   * True when the stage beneath is not a playing excerpt (interstitial, cold-start
   * resolve, stills): mount opaque — the dissolve-in is reserved for the video→card
   * seam, and anywhere else it would dip to a stale frame or bare thumbnail.
   */
  entersOpaque?: boolean
}

export function ChapterCard({
  title,
  subtitle,
  position,
  total,
  entersOpaque,
}: ChapterCardProps) {
  const reduceMotion = useReduceMotion()
  const enter = useRef(new Animated.Value(0)).current
  const rootFade = useRef(new Animated.Value(0)).current
  // Mount-time latch: the flag describes the seam this card ENTERED through, and the
  // screen's previous-phase bookkeeping moves on while the card is still up.
  const entersOpaqueRef = useRef(entersOpaque === true)
  // A cross-chapter failExcerpt updates this card IN PLACE (new `position`, no
  // remount); once shown, stay opaque — never snap transparent and re-dissolve.
  const hasShownRef = useRef(false)

  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1)
      return
    }
    enter.setValue(0)
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [enter, reduceMotion, position])

  // The opaque root dissolves over the reel beneath: in over the outgoing frame's
  // poster crossfade, out to reveal the next excerpt's poster (the unmount then
  // removes a fully transparent view). Reduce-motion keeps today's immediate cuts.
  useEffect(() => {
    const skipDissolve = entersOpaqueRef.current || hasShownRef.current
    hasShownRef.current = true
    if (reduceMotion) {
      rootFade.setValue(1)
      return
    }
    let fadeIn: Animated.CompositeAnimation | null = null
    if (skipDissolve) {
      rootFade.setValue(1)
    } else {
      rootFade.setValue(0)
      fadeIn = Animated.timing(rootFade, {
        toValue: 1,
        duration: OVERLAY_CROSSFADE_MS,
        useNativeDriver: true,
      })
      fadeIn.start()
    }
    let fadeOut: Animated.CompositeAnimation | null = null
    const exitTimer = setTimeout(
      () => {
        fadeOut = Animated.timing(rootFade, {
          toValue: 0,
          duration: OVERLAY_CROSSFADE_MS,
          useNativeDriver: true,
        })
        fadeOut.start()
      },
      // The margin keeps the fade ahead of the reducer's own unmount timer.
      Math.max(
        0,
        CHAPTER_CARD_DURATION_MS -
          OVERLAY_CROSSFADE_MS -
          OVERLAY_EXIT_MARGIN_MS,
      ),
    )
    return () => {
      fadeIn?.stop()
      fadeOut?.stop()
      clearTimeout(exitTimer)
    }
  }, [rootFade, reduceMotion, position])

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [RISE_DISTANCE, 0],
  })

  return (
    // collapsable={false}: Android TV paints the (still-mounted, silent) VideoView
    // over every flattened RN view. Decorative, so it takes no focus and no a11y.
    <Animated.View
      style={[styles.root, { opacity: rootFade }]}
      pointerEvents="none"
      collapsable={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[styles.copy, { opacity: enter, transform: [{ translateY }] }]}
        collapsable={false}
      >
        <Text style={styles.title}>{title}</Text>
        {subtitle != null && subtitle.trim().length > 0 ? (
          <Text style={styles.subtitle}>{subtitle}</Text>
        ) : null}
      </Animated.View>

      {total > 1 ? (
        <Animated.View style={[styles.dots, { opacity: enter }]}>
          {Array.from({ length: total }, (_, index) => (
            <View
              key={`chapter-dot-${index}`}
              style={[
                styles.dot,
                index === position - 1 ? styles.dotActive : null,
              ]}
            />
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: scale(120),
    backgroundColor: WATCH_THEME.below,
  },
  copy: {
    alignItems: "center",
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(72)),
    fontWeight: "700",
    lineHeight: Math.round(scale(84)),
    color: WATCH_THEME.text,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(28)),
    fontWeight: "400",
    lineHeight: Math.round(scale(40)),
    color: WATCH_THEME.text62,
    textAlign: "center",
    maxWidth: scale(1100),
    marginTop: scale(20),
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
    marginTop: scale(56),
  },
  dot: {
    width: scale(8),
    height: scale(8),
    borderRadius: scale(4),
    backgroundColor: DOT_RESTING,
  },
  dotActive: {
    width: scale(28),
    backgroundColor: WATCH_THEME.accent,
  },
})
