import { useEffect, useRef } from "react"
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native"

import { SURFACE_COLOR } from "../../lib/color"

type VideoDetailSkeletonProps = {
  /**
   * "full" includes the player block + title (cold deep link with no seed).
   * "sections" omits them because the real player + seed title render above
   * this skeleton (seeded navigation) — keeps the layout from shifting when
   * canonical data lands.
   */
  variant?: "full" | "sections"
}

const PLAYER_HEIGHT_RATIO = 9 / 16

export function VideoDetailSkeleton({
  variant = "full",
}: VideoDetailSkeletonProps) {
  const { width: screenWidth } = useWindowDimensions()
  const playerHeight = Math.round(screenWidth * PLAYER_HEIGHT_RATIO)
  const cardWidth = Math.round(screenWidth * 0.45)
  const cardHeight = Math.round(cardWidth / (16 / 9))

  const opacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    let cancelled = false
    let loop: Animated.CompositeAnimation | null = null

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (cancelled || reduceMotion) {
          opacity.setValue(0.5)
          return
        }
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.7,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0.3,
              duration: 800,
              useNativeDriver: true,
            }),
          ]),
        )
        loop.start()
      })
      .catch(() => opacity.setValue(0.5))

    return () => {
      cancelled = true
      loop?.stop()
    }
  }, [opacity])

  const Block = ({ style }: { style: object }) => (
    <Animated.View style={[styles.block, style, { opacity }]} />
  )

  return (
    <View accessibilityLabel="Loading video" accessibilityRole="progressbar">
      {variant === "full" && (
        <>
          <Animated.View
            style={[styles.player, { height: playerHeight, opacity }]}
          />
          <View style={styles.body}>
            <Block style={styles.title} />
          </View>
        </>
      )}

      <View style={variant === "full" ? styles.bodyNoTop : styles.body}>
        <View style={styles.actionRow}>
          <Block style={styles.actionItem} />
          <Block style={styles.actionItem} />
          <Block style={styles.actionItem} />
          <Block style={styles.actionItem} />
        </View>

        <Block style={styles.lineFull} />
        <Block style={styles.lineFull} />
        <Block style={styles.lineShort} />

        <Block style={styles.sectionHeading} />
        <View style={styles.carousel}>
          <Block style={{ width: cardWidth, height: cardHeight }} />
          <Block style={{ width: cardWidth, height: cardHeight }} />
        </View>
      </View>
    </View>
  )
}

const RADIUS = 8

const styles = StyleSheet.create({
  player: {
    width: "100%",
    backgroundColor: SURFACE_COLOR,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  bodyNoTop: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  block: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: RADIUS,
  },
  title: {
    height: 26,
    width: "70%",
    marginBottom: 4,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    marginBottom: 20,
  },
  actionItem: {
    flex: 1,
    height: 36,
    borderRadius: 12,
  },
  lineFull: {
    height: 13,
    width: "100%",
    marginBottom: 10,
  },
  lineShort: {
    height: 13,
    width: "55%",
    marginBottom: 24,
  },
  sectionHeading: {
    height: 20,
    width: "35%",
    marginBottom: 14,
  },
  carousel: {
    flexDirection: "row",
    gap: 12,
  },
})
