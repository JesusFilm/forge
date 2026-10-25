/**
 * R9's stat interstitial: the curator's authored global claims plus one live claim
 * computed from the video that just played. Renders nothing without authored stats —
 * one video's language count is not the breadth claim (statLines.ts owns that rule).
 */

import { useEffect, useRef } from "react"
import { Animated, StyleSheet, Text, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { scale } from "../../lib/scale"
import {
  INTERSTITIAL_DURATION_MS,
  OVERLAY_CROSSFADE_MS,
  OVERLAY_EXIT_MARGIN_MS,
} from "../../lib/showcaseMode/reelState"
import { buildInterstitialContent } from "../../lib/showcaseMode/statLines"
import { WATCH_THEME } from "../watch/watchDetailTheme"

const ENTER_MS = 480
// The root dissolves IN over the ended excerpt's frame but never out — the chapter
// card that follows mounts opaque over the same dark stage (ChapterCard's
// entersOpaque), so the seam is a text swap, not a dip to the frame beneath.

export type StatInterstitialProps = {
  /** Authored globals from the Showcase Experience (KTD-10 `showcase-stats`). */
  authoredLines: readonly string[]
  /** The current video's resolved title — the live line's subject. */
  liveTitle: string | null
  /** Distinct playable languages on the current video (countDistinctLanguages). */
  liveLanguageCount: number | null
}

export function StatInterstitial({
  authoredLines,
  liveTitle,
  liveLanguageCount,
}: StatInterstitialProps) {
  const reduceMotion = useReduceMotion()
  const enter = useRef(new Animated.Value(0)).current
  const rootFade = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1)
      return
    }
    enter.setValue(0)
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: ENTER_MS,
      useNativeDriver: true,
    })
    anim.start()
    // The copy bows out before the phase flips, so the following card's title enters
    // over an empty dark stage instead of hard-swapping with the stats text.
    let copyExit: Animated.CompositeAnimation | null = null
    const exitTimer = setTimeout(
      () => {
        copyExit = Animated.timing(enter, {
          toValue: 0,
          duration: OVERLAY_CROSSFADE_MS,
          useNativeDriver: true,
        })
        copyExit.start()
      },
      // The margin keeps the fade ahead of the reducer's own unmount timer.
      Math.max(
        0,
        INTERSTITIAL_DURATION_MS -
          OVERLAY_CROSSFADE_MS -
          OVERLAY_EXIT_MARGIN_MS,
      ),
    )
    return () => {
      anim.stop()
      copyExit?.stop()
      clearTimeout(exitTimer)
    }
  }, [enter, reduceMotion])

  useEffect(() => {
    if (reduceMotion) {
      rootFade.setValue(1)
      return
    }
    rootFade.setValue(0)
    const fadeIn = Animated.timing(rootFade, {
      toValue: 1,
      duration: OVERLAY_CROSSFADE_MS,
      useNativeDriver: true,
    })
    fadeIn.start()
    return () => fadeIn.stop()
  }, [rootFade, reduceMotion])

  const content = buildInterstitialContent({
    authoredLines,
    liveTitle,
    liveLanguageCount,
  })
  if (content == null) return null

  return (
    <Animated.View
      style={[styles.root, { opacity: rootFade }]}
      pointerEvents="none"
      collapsable={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.copy, { opacity: enter }]}>
        {content.authoredLines.map((line, index) => (
          <Text key={`stat-line-${index}`} style={styles.authoredLine}>
            {line}
          </Text>
        ))}

        {content.liveLine != null ? (
          <>
            <View style={styles.rule} />
            <Text style={styles.liveLine}>{content.liveLine}</Text>
          </>
        ) : null}
      </Animated.View>
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
  authoredLine: {
    fontFamily: "System",
    fontSize: Math.round(scale(48)),
    fontWeight: "700",
    lineHeight: Math.round(scale(66)),
    color: WATCH_THEME.text,
    textAlign: "center",
  },
  rule: {
    width: scale(72),
    height: scale(3),
    borderRadius: scale(2),
    backgroundColor: WATCH_THEME.accent,
    marginVertical: scale(36),
  },
  liveLine: {
    fontFamily: "System",
    fontSize: Math.round(scale(26)),
    fontWeight: "500",
    lineHeight: Math.round(scale(38)),
    color: WATCH_THEME.text74,
    textAlign: "center",
    maxWidth: scale(1100),
  },
})
