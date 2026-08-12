import { Platform, StyleSheet, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { BG_COLOR, hexToRgba } from "../../lib/color"
import { PLAYER_HEIGHT_RATIO } from "../../lib/playerLayout"

// Matches apps/tv's shipped crossfade token (HomeBackdrop CROSSFADE_MS).
const AMBIENT_FADE_MS = 600
// Ceiling is status-bar contrast, not taste: a worst-case bright wash over
// BG_COLOR holds ~7:1 against the white glyphs here. Do not exceed 0.5.
const AMBIENT_MAX_OPACITY = 0.45
// How far the wash bleeds below the player before dissolving into BG_COLOR.
const AMBIENT_BLEED = 160
// expo-image halves the iOS value internally; keep the ~3x iOS:Android ratio
// the TopicCard precedent uses rather than equalising the numbers.
const AMBIENT_BLUR = Platform.OS === "ios" ? 50 : 16

const FADE_COLORS = [
  hexToRgba(BG_COLOR, 0.15),
  hexToRgba(BG_COLOR, 0.15),
  BG_COLOR,
] as const
const FADE_LOCATIONS = [0, 0.55, 1] as const

type WatchAmbientProps = {
  posterUrl: string | null
  /** Safe-area top inset — the strip this layer exists to colour. */
  topInset: number
}

/**
 * Ambient wash behind the player: the poster, blurred and dimmed, bleeding
 * under the title before dissolving into BG_COLOR. PER-VIDEO, not per-scene —
 * it tracks the poster, so it does not follow cuts the way YouTube's does.
 */
export function WatchAmbient({ posterUrl, topInset }: WatchAmbientProps) {
  const { width } = useWindowDimensions()
  if (posterUrl == null) return null

  const height =
    topInset + Math.round(width * PLAYER_HEIGHT_RATIO) + AMBIENT_BLEED

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { height }]}
    >
      <Image
        // Static key: this layer is a singleton and is never recycled, so the
        // value never changes and cannot blank the view mid-cross-fade.
        recyclingKey="watch-ambient"
        source={posterUrl}
        style={[StyleSheet.absoluteFill, styles.art]}
        contentFit="cover"
        blurRadius={AMBIENT_BLUR}
        cachePolicy="memory-disk"
        transition={AMBIENT_FADE_MS}
      />
      <LinearGradient
        colors={FADE_COLORS}
        locations={FADE_LOCATIONS}
        style={StyleSheet.absoluteFill}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
    opacity: AMBIENT_MAX_OPACITY,
  },
  art: {
    // Cosmetic: hides the hard blur edge at the frame boundary.
    transform: [{ scale: 1.1 }],
  },
})
