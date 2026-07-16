/**
 * R9's stat interstitial: the curator's authored global claims plus one live claim
 * computed from the video that just played. Renders nothing without authored stats —
 * one video's language count is not the breadth claim (statLines.ts owns that rule).
 */

import { useEffect, useRef } from "react"
import { Animated, StyleSheet, Text, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { scale } from "../../lib/scale"
import { buildInterstitialContent } from "../../lib/showcaseMode/statLines"
import { WATCH_THEME } from "../watch/watchDetailTheme"

const ENTER_MS = 480

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
    return () => anim.stop()
  }, [enter, reduceMotion])

  const content = buildInterstitialContent({
    authoredLines,
    liveTitle,
    liveLanguageCount,
  })
  if (content == null) return null

  return (
    <View
      style={styles.root}
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
    </View>
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
