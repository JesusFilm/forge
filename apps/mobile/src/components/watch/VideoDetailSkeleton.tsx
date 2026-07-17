import { Animated, StyleSheet, View, useWindowDimensions } from "react-native"

import { SURFACE_COLOR } from "../../lib/color"
import { PLAYER_HEIGHT_RATIO } from "../../lib/playerLayout"
import { useShimmerOpacity } from "../../hooks/useShimmerOpacity"

type VideoDetailSkeletonProps = {
  /**
   * "full" includes player block + title (cold deep link, no seed). "sections"
   * omits them because the real player + seed title already render above (seeded
   * nav) — keeps layout from shifting when canonical data lands.
   */
  variant?: "full" | "sections"
  /**
   * Top inset for the player block, so a headerless watch screen passes
   * insets.top to avoid a downward jump when data lands. Default 0 (e.g. series,
   * which has a native header). Only affects "full".
   */
  playerTopInset?: number
  /**
   * Per-side horizontal inset for the player block, matching a parent that
   * insets the real player. Default 0. Only affects "full".
   */
  playerHorizontalInset?: number
}

export function VideoDetailSkeleton({
  variant = "full",
  playerTopInset = 0,
  playerHorizontalInset = 0,
}: VideoDetailSkeletonProps) {
  const { width: screenWidth } = useWindowDimensions()
  const playerHeight = Math.round(
    (screenWidth - playerHorizontalInset * 2) * PLAYER_HEIGHT_RATIO,
  )
  const cardWidth = Math.round(screenWidth * 0.45)
  const cardHeight = Math.round(cardWidth / (16 / 9))

  // Shared fade-in/out so the skeleton reads as "loading", not "failed".
  const opacity = useShimmerOpacity()

  return (
    <View accessibilityLabel="Loading video" accessibilityRole="progressbar">
      {variant === "full" && (
        <>
          <Animated.View
            style={[
              styles.player,
              {
                width: screenWidth - playerHorizontalInset * 2,
                height: playerHeight,
                marginTop: playerTopInset,
                marginHorizontal: playerHorizontalInset,
                opacity,
              },
            ]}
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
    // width is set inline (screenWidth - inset*2) so the block matches the
    // real player's inset width; no static width here to override.
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
