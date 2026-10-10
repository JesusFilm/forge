import { useEffect, useRef } from "react"
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { BG_COLOR, BLACK, hexToRgba } from "../../lib/color"
import { PLAYER_HEIGHT_RATIO } from "../../lib/playerLayout"
import { usePlaybackPlaying } from "../../hooks/usePlaybackFrame"

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

// THE KNOB: 0 hands the wash fully over to black during playback, 1 disables
// the behaviour. Why black rather than BG_COLOR, and why at all: see
// apps/mobile/CLAUDE.md, "Common Pitfalls".
const PLAYING_OPACITY_MULTIPLIER = 0
// Deliberately slow: a quick dip reads as a glitch next to the video, where a
// long ramp reads as the room settling. Applies to BOTH directions.
const PLAY_FADE_MS = 3000

const FADE_COLORS = [
  hexToRgba(BG_COLOR, 0.15),
  hexToRgba(BG_COLOR, 0.15),
  BG_COLOR,
] as const
const FADE_LOCATIONS = [0, 0.55, 1] as const

// Dissolves into BG_COLOR rather than ending opaque on the clipped edge, which
// is the seam this layer was already fixed for once.
const BLACK_FADE_COLORS = [BLACK, BLACK, BG_COLOR] as const

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
  const playing = usePlaybackPlaying()
  // Seeded from the CURRENT state, not a literal: a screen mounting while the
  // video already plays would otherwise re-present the wash and fade it out
  // again over the full ramp.
  const initialTarget = playing ? PLAYING_OPACITY_MULTIPLIER : 1
  const playFade = useRef(new Animated.Value(initialTarget)).current
  const targetRef = useRef(initialTarget)

  useEffect(() => {
    const target = playing ? PLAYING_OPACITY_MULTIPLIER : 1
    // Mount already sits on its target, so animating there is a 3s no-op.
    if (targetRef.current === target) return
    targetRef.current = target
    Animated.timing(playFade, {
      toValue: target,
      duration: PLAY_FADE_MS,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [playing, playFade])

  if (posterUrl == null) return null

  const playerHeight = Math.round(width * PLAYER_HEIGHT_RATIO)
  const height = topInset + playerHeight + AMBIENT_BLEED
  // Derived, never hard-coded: the strip above the player and the bleed below it
  // change with the inset and the screen width, and the black must stay solid
  // across the whole player so both bars sit on their own colour.
  const blackLocations = [
    0,
    Math.min((topInset + playerHeight) / height, 0.999),
    1,
  ] as const

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.wrapper, { height }]}
    >
      {/* The poster wash, which retires while the video plays. Its fade rides
          its OWN node: a second `opacity` in the group's style array would win
          over AMBIENT_MAX_OPACITY and silently drop the contrast ceiling. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: playFade }]}>
        <View
          // Android applies a group's `opacity` PER CHILD without this, so the
          // gradient's opaque tail blends over a dimmed poster instead of covering
          // it — the wash never reaches BG_COLOR and seams. No-op on iOS.
          needsOffscreenAlphaCompositing
          style={styles.root}
        >
          <Image
            // Static key: this layer is a singleton and is never recycled, so
            // the value never changes and cannot blank the view mid-cross-fade.
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
      </Animated.View>

      {/* The black settle, arriving as the wash leaves. Driven by the SAME
          value inverted, so the two can never both be up or both be gone. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: playFade.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
          },
        ]}
      >
        <LinearGradient
          colors={BLACK_FADE_COLORS}
          locations={blackLocations}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  root: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
    opacity: AMBIENT_MAX_OPACITY,
  },
  art: {
    // Cosmetic: hides the hard blur edge at the frame boundary.
    transform: [{ scale: 1.1 }],
  },
})
