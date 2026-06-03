import { Animated, StyleSheet, View, useWindowDimensions } from "react-native"

import { SURFACE_COLOR } from "../../lib/color"
import { useShimmerOpacity } from "../../hooks/useShimmerOpacity"

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

  // Shared fade-in/out so the skeleton reads as "loading", not "failed".
  const opacity = useShimmerOpacity()

  return (
    <View accessibilityLabel="Loading video" accessibilityRole="progressbar">
      {variant === "full" && (
        <>
          <Animated.View
            style={[styles.player, { height: playerHeight, opacity }]}
          />
          <View style={styles.body}>
            <Animated.View style={[styles.block, styles.title, { opacity }]} />
          </View>
        </>
      )}

      <View style={variant === "full" ? styles.bodyNoTop : styles.body}>
        <View style={styles.actionRow}>
          <Animated.View
            style={[styles.block, styles.actionItem, { opacity }]}
          />
          <Animated.View
            style={[styles.block, styles.actionItem, { opacity }]}
          />
          <Animated.View
            style={[styles.block, styles.actionItem, { opacity }]}
          />
          <Animated.View
            style={[styles.block, styles.actionItem, { opacity }]}
          />
        </View>

        <Animated.View style={[styles.block, styles.lineFull, { opacity }]} />
        <Animated.View style={[styles.block, styles.lineFull, { opacity }]} />
        <Animated.View style={[styles.block, styles.lineShort, { opacity }]} />

        <Animated.View
          style={[styles.block, styles.sectionHeading, { opacity }]}
        />
        <View style={styles.carousel}>
          <Animated.View
            style={[
              styles.block,
              { width: cardWidth, height: cardHeight, opacity },
            ]}
          />
          <Animated.View
            style={[
              styles.block,
              { width: cardWidth, height: cardHeight, opacity },
            ]}
          />
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
