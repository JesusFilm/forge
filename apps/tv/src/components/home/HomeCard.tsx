// One Home rail card: a 16:9 thumbnail with a bottom title overlay and an
// optional metaLabel badge ("3 episodes" / duration). Fixed dims — exported
// for HomeRail's getItemLayout — so the list virtualizes without a measuring
// pass.
//
// Focus follows the Crimson Gallery spec: 1.05x lift + crimson glow, eased by
// useFocusAnimation (no "blink"), with the glow on the OUTER wrapper and the
// image clip on the INNER view — a shadow on an overflow:hidden view is
// clipped away on iOS (same split as FocusableCard / EpisodeRail).
//
// `onFocus`/`onPress` re-emit the `card` PROP the component closed over —
// never re-indexed from the rail's data array, which can shrink between a
// queued focus event and its handler (patterns doc §7).

import { memo, useMemo } from "react"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"

import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { focusTransform, useFocusAnimation } from "../watch/useFocusAnimation"

export const HOME_CARD_WIDTH = scale(400)
export const HOME_CARD_HEIGHT = scale(225) // 16:9 of the width

// Bottom scrim so the overlaid title reads over artwork. Module-scope (the
// inputs are module constants) so the gradient props keep one identity across
// renders.
const TITLE_SCRIM_COLORS = [
  hexToRgba(COLORS.surface, 0.92),
  hexToRgba(COLORS.surface, 0.35),
  hexToRgba(COLORS.surface, 0),
] as const
const TITLE_SCRIM_LOCATIONS = [0, 0.5, 1] as const
const TITLE_SCRIM_START = { x: 0.5, y: 1 }
const TITLE_SCRIM_END = { x: 0.5, y: 0 }

type HomeCardProps = {
  card: WatchHomeCard
  onFocus: (card: WatchHomeCard) => void
  onPress: (card: WatchHomeCard) => void
  index: number
}

export const HomeCard = memo(function HomeCard({
  card,
  onFocus,
  onPress,
  index,
}: HomeCardProps) {
  const { setFocused, progress } = useFocusAnimation()
  // CMS-sourced URL is untrusted — sanitize before it reaches expo-image.
  const imageUrl = useMemo(
    () => (card.imageUrl != null ? resolveImageUrl(card.imageUrl) : null),
    [card.imageUrl],
  )
  const isSeriesShaped = card.childCount > 0

  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const liftStyle = useMemo(
    () => ({
      transform: focusTransform(progress, { lift: scale(8), magnify: 1.05 }),
    }),
    [progress],
  )
  const glowStyle = useMemo(
    () => ({
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.7],
      }),
    }),
    [progress],
  )

  return (
    <Pressable
      onPress={() => onPress(card)}
      onFocus={() => {
        setFocused(true)
        onFocus(card)
      }}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={card.title}
      accessibilityHint={
        isSeriesShaped ? "Opens this series" : "Opens this video"
      }
      testID={`home-card-${card.id}-${index}`}
    >
      <Animated.View style={[styles.card, liftStyle]}>
        <Animated.View style={[styles.glowWrap, glowStyle]}>
          <View style={styles.thumb}>
            {imageUrl != null ? (
              <Image
                source={{ uri: imageUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={`home-card-${card.id}`}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.thumbFallback]} />
            )}

            <LinearGradient
              colors={TITLE_SCRIM_COLORS}
              locations={TITLE_SCRIM_LOCATIONS}
              start={TITLE_SCRIM_START}
              end={TITLE_SCRIM_END}
              style={styles.titleScrim}
              pointerEvents="none"
              collapsable={false}
            />

            {card.metaLabel != null ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText} numberOfLines={1}>
                  {card.metaLabel}
                </Text>
              </View>
            ) : null}

            <View style={styles.titleBlock} pointerEvents="none">
              <Text style={styles.title} numberOfLines={2}>
                {card.title}
              </Text>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  card: {
    width: HOME_CARD_WIDTH,
    height: HOME_CARD_HEIGHT,
  },
  // Crimson focus glow; shadowOpacity is animated (0 at rest). Outer wrapper
  // stays overflow-visible so iOS doesn't clip the shadow.
  glowWrap: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(16),
    shadowColor: COLORS.primary,
    shadowRadius: scale(16),
    shadowOffset: { width: 0, height: 0 },
  },
  thumb: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(16),
    overflow: "hidden",
    backgroundColor: COLORS.surfaceContainer,
  },
  thumbFallback: {
    backgroundColor: COLORS.surfaceContainerHigh,
  },
  titleScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
  },
  titleBlock: {
    position: "absolute",
    left: scale(20),
    right: scale(20),
    bottom: scale(16),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "600",
    letterSpacing: -scale(0.2),
    color: COLORS.text,
  },
  badge: {
    position: "absolute",
    top: scale(14),
    right: scale(14),
    maxWidth: HOME_CARD_WIDTH - scale(28),
    paddingHorizontal: scale(14),
    paddingVertical: scale(6),
    borderRadius: scale(16),
    backgroundColor: hexToRgba(COLORS.surface, 0.78),
  },
  badgeText: {
    fontFamily: "System",
    fontSize: Math.round(scale(17)),
    fontWeight: "600",
    color: COLORS.text,
  },
})
