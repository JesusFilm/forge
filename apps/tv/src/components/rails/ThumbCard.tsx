// The fixed-size video thumb card shared by the Episodes and Up Next rails:
// 32:15 poster + optional accent eyebrow + title, focus via the shared "thumb"
// role (lift + ring + shadow + icon overlay). Was two near-verbatim copies.

import { useMemo } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"

import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import {
  THUMB_SHADOW,
  useFocusVisual,
  useThumbFocusRing,
} from "../focus/useFocusVisual"
import { useHoverPreview } from "../focus/useHoverPreview"
import { HoverPreviewImage } from "../watch/HoverPreviewImage"
import { WATCH_THEME } from "../watch/watchDetailTheme"

export const THUMB_CARD_WIDTH = scale(360)
// 32:15 (2.13:1), matches the cinematic source art.
export const THUMB_CARD_HEIGHT = scale(168.75)

type ThumbCardProps = {
  title: string
  /** Raw CMS poster URL — sanitized here before it reaches expo-image. */
  posterUrl: string | null | undefined
  /** Accent eyebrow line above the title (e.g. "EPISODE 3"); omit to hide. */
  eyebrow?: string | null
  /** Focus-overlay glyph: "albums" marks a nested Series-Shaped card. */
  overlayIcon?: "play" | "albums"
  /** Mux playback id for the focus hover-preview (U7 renders it); null/omitted = no preview. */
  previewPlaybackId?: string | null
  recyclingKey: string
  /** Stable, low-cardinality RUM action name (auto-tracker would use the title). */
  ddActionName: string
  accessibilityHint: string
  onPress: () => void
}

export function ThumbCard({
  title,
  posterUrl,
  eyebrow,
  overlayIcon = "play",
  previewPlaybackId,
  recyclingKey,
  ddActionName,
  accessibilityHint,
  onPress,
}: ThumbCardProps) {
  // Focus eases in (no "blink"): the card lifts + magnifies, the white ring
  // fades in, and the overlay icon fades in over ~180ms.
  const { focused, setFocused, progress, transform } = useFocusVisual("thumb", {
    nativeDriver: false,
  })
  const previewUrl = useHoverPreview({
    focused,
    enabled: true,
    playbackId: previewPlaybackId ?? null,
  })
  const poster = useMemo(
    () => (posterUrl != null ? resolveImageUrl(posterUrl) : null),
    [posterUrl],
  )

  const cardStyle = useMemo(() => ({ transform }), [transform])
  const { shadowStyle, ringStyle, ringFrame } = useThumbFocusRing(
    progress,
    THUMB_CARD_WIDTH,
    THUMB_CARD_HEIGHT,
  )

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={title}
      {...{ "dd-action-name": ddActionName }}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View style={[styles.card, cardStyle]}>
        {/* Neutral drop shadow on the outer wrapper (overflow visible);
            image-clipping on the inner view (overflow hidden). A shadow on an
            overflow:hidden view is clipped away on iOS — same outer/inner split
            as FocusableCard. */}
        <Animated.View style={[styles.thumbWrap, shadowStyle]}>
          <View style={styles.thumb}>
            {poster != null ? (
              <Image
                source={{ uri: poster }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                contentPosition="top left"
                recyclingKey={recyclingKey}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.thumbFallback]} />
            )}
            <Animated.View style={[styles.focusOverlay, { opacity: progress }]}>
              <Ionicons
                name={overlayIcon}
                size={Math.round(scale(42))}
                color={WATCH_THEME.text}
              />
            </Animated.View>
            {/* Above the poster + focus scrim/icon so the preview reads as clean
                motion; the white ring (outside the clip) stays on top. */}
            <HoverPreviewImage previewUrl={previewUrl} contentFit="cover" />
          </View>
        </Animated.View>

        {/* White focus ring hugging the thumb — matches HomeCard. */}
        <Animated.View style={[ringFrame, ringStyle]} pointerEvents="none" />

        <View style={styles.meta}>
          {eyebrow != null && eyebrow !== "" ? (
            <Text style={styles.eyebrow} numberOfLines={1}>
              {eyebrow}
            </Text>
          ) : null}
          <Text style={styles.cardTitle} numberOfLines={2}>
            {title}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    width: THUMB_CARD_WIDTH,
  },
  // Neutral dark drop shadow for depth (matches HomeCard), revealed by the
  // animated opacity. On the OUTER wrapper so iOS doesn't clip it (the inner
  // thumb is overflow:hidden).
  thumbWrap: {
    width: THUMB_CARD_WIDTH,
    height: THUMB_CARD_HEIGHT,
    borderRadius: scale(16),
    ...THUMB_SHADOW,
  },
  thumb: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(16),
    overflow: "hidden",
    backgroundColor: WATCH_THEME.below,
  },
  thumbFallback: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  focusOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  meta: {
    paddingTop: scale(16),
    paddingHorizontal: scale(4),
  },
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(17)),
    fontWeight: "700",
    letterSpacing: scale(1.6),
    color: WATCH_THEME.accent,
    textTransform: "uppercase",
  },
  cardTitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "600",
    color: WATCH_THEME.text,
    marginTop: scale(6),
    letterSpacing: -scale(0.2),
  },
})
