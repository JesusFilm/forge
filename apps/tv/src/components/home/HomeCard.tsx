// One Home rail card, restyled per the Forge TV Home design: a 16:9 thumb
// (radius 16, hairline white border) with the metaLabel chip top-right, and
// the labels BELOW the art — title line + kind line (the card's display
// label, e.g. "Feature film" / "Series"). Fixed width — exported for
// HomeRail's getItemLayout — so the list virtualizes without a measuring
// pass.
//
// Focus: translateY(-8) + scale(1.06) eased by useFocusAnimation, with a
// 5px WHITE ring + deep dark shadow replacing the app-wide crimson glow ON
// HOME CARDS ONLY (FocusableCard and other screens keep theirs). The ring is
// an absolute DECORATIVE overlay (pointerEvents "none" — fine; only
// focusables must avoid absolute positioning) so it never shifts layout, and
// the shadow lives on a separate overflow-visible wrapper because iOS clips
// shadows on overflow:hidden views.
//
// `onFocus`/`onPress` re-emit the `card` PROP the component closed over —
// never re-indexed from the rail's data array, which can shrink between a
// queued focus event and its handler (patterns doc §7).

import { memo, useMemo } from "react"
import { Image } from "expo-image"
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import type { View as ViewType } from "react-native"

import { isSeriesSearchResult } from "../../lib/isSeriesRecord"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { focusTransform, useFocusAnimation } from "../watch/useFocusAnimation"
import { WATCH_THEME } from "../watch/watchDetailTheme"

// Card size is identical on both platforms (unchanged from main). The Android
// home's slightly-lower card density comes only from a wider ITEM_GAP (HomeRail),
// not the card width — so nothing here diverges for tvOS.
export const HOME_CARD_WIDTH = scale(400)
export const HOME_CARD_THUMB_HEIGHT = scale(225) // 16:9 of the width

/** How far the white focus ring sits outside the thumb edge. */
const RING_WIDTH = scale(5)

// Android runs the focus tween on the native driver (off the JS thread, the
// D-pad-move bottleneck on the weak SoC) and drops the JS shadow (iOS shadow*
// doesn't render on Android anyway). tvOS keeps the full JS treatment.
const IS_ANDROID = Platform.OS === "android"

type HomeCardProps = {
  card: WatchHomeCard
  onFocus: (card: WatchHomeCard) => void
  onPress: (card: WatchHomeCard) => void
  index: number
  /**
   * Forced D-pad-up destination (the featured rail wires the Search tab here
   * so edge cards reach the centered top bar, which has no horizontal overlap
   * above them). Pressable forwards this to its host View via
   * tagForComponentOrHandle, so a node instance works directly.
   */
  nextFocusUp?: ViewType | null
  /**
   * Exposes this card's native node. The rail captures its LAST real card's
   * node so the invisible over-hang pad cards can bounce focus to it via
   * requestTVFocus(). Ref-as-state in the rail, like MissionSection.
   */
  nodeRef?: (node: ViewType | null) => void
  /**
   * Whether to load the artwork. Off-window rails (Android image-windowing) pass
   * false: the card still mounts at full size and stays focusable — so D-pad
   * focus never lands on an empty rail — but skips the expensive image decode.
   */
  loadImage?: boolean
}

export const HomeCard = memo(function HomeCard({
  card,
  onFocus,
  onPress,
  index,
  loadImage = true,
  nextFocusUp,
  nodeRef,
}: HomeCardProps) {
  const { focused, setFocused, progress } = useFocusAnimation({
    nativeDriver: IS_ANDROID,
  })
  // CMS-sourced URL is untrusted — sanitize before it reaches expo-image.
  const imageUrl = useMemo(
    () => (card.imageUrl != null ? resolveImageUrl(card.imageUrl) : null),
    [card.imageUrl],
  )
  // Same predicate as resolveHomeCardPath (homeCardRouting.ts) so the hint
  // can never announce a different destination than the press routes to.
  const isSeriesShaped = isSeriesSearchResult({
    label: card.rawLabel,
    childCount: card.childCount,
  })

  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const liftStyle = useMemo(
    () => ({
      transform: focusTransform(progress, { lift: scale(8), magnify: 1.06 }),
    }),
    [progress],
  )
  // Android skips the animated shadow: the native driver rejects shadow/color
  // props and iOS shadow* doesn't render on Android anyway. tvOS keeps it.
  const shadowStyle = useMemo(
    () =>
      IS_ANDROID
        ? undefined
        : {
            shadowOpacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.8],
            }),
          },
    [progress],
  )
  const ringStyle = useMemo(() => ({ opacity: progress }), [progress])

  return (
    <Pressable
      ref={nodeRef}
      onPress={() => onPress(card)}
      onFocus={() => {
        setFocused(true)
        onFocus(card)
      }}
      onBlur={() => setFocused(false)}
      nextFocusUp={nextFocusUp}
      accessibilityRole="button"
      accessibilityLabel={card.title}
      accessibilityHint={
        isSeriesShaped ? "Opens this series" : "Opens this video"
      }
      testID={`home-card-${card.id}-${index}`}
    >
      <Animated.View style={[styles.card, liftStyle]}>
        <View style={styles.thumbBox}>
          {/* Deep dark drop shadow, revealed by the animated opacity. Kept
              on its own overflow-visible wrapper so iOS doesn't clip it. */}
          <Animated.View style={[styles.shadowWrap, shadowStyle]}>
            <View style={styles.thumb}>
              {imageUrl != null && loadImage ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  recyclingKey={`home-card-${card.id}`}
                  // Android only: de-prioritize decodes so they don't saturate
                  // the queue ahead of the focused card; memory-disk makes
                  // re-entry instant. tvOS keeps expo-image defaults (unchanged).
                  priority={IS_ANDROID ? "low" : undefined}
                  cachePolicy={IS_ANDROID ? "memory-disk" : undefined}
                />
              ) : (
                // No artwork yet (missing URL, or off-window: loadImage=false).
                // The card keeps its size + focusability; only the decode is
                // skipped, so focus can still traverse this rail.
                <View style={[StyleSheet.absoluteFill, styles.thumbFallback]} />
              )}

              {/* Hairline edge (design: 1px white .07). Dropped on Android —
                  one fewer view per card to redraw during a scroll. */}
              {IS_ANDROID ? null : (
                <View style={styles.thumbEdge} pointerEvents="none" />
              )}

              {card.metaLabel != null ? (
                <View style={styles.chip} pointerEvents="none">
                  <Text style={styles.chipText} numberOfLines={1}>
                    {card.metaLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          </Animated.View>

          {/* White focus ring just outside the thumb (decorative overlay). */}
          <Animated.View
            style={[styles.focusRing, ringStyle]}
            pointerEvents="none"
          />
        </View>

        <View style={styles.meta} pointerEvents="none">
          <Text
            style={[styles.title, focused && styles.titleFocused]}
            numberOfLines={1}
          >
            {card.title}
          </Text>
          <Text style={styles.kind} numberOfLines={1}>
            {card.label}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  card: {
    width: HOME_CARD_WIDTH,
  },
  thumbBox: {
    width: HOME_CARD_WIDTH,
    height: HOME_CARD_THUMB_HEIGHT,
  },
  shadowWrap: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(16),
    shadowColor: "#000000",
    shadowRadius: scale(25),
    shadowOffset: { width: 0, height: scale(16) },
  },
  thumb: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(16),
    overflow: "hidden",
    backgroundColor: WATCH_THEME.scrim(1),
  },
  thumbFallback: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  thumbEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(16),
    borderWidth: scale(1),
    borderColor: "rgba(255,255,255,0.07)",
  },
  focusRing: {
    position: "absolute",
    top: -RING_WIDTH,
    bottom: -RING_WIDTH,
    left: -RING_WIDTH,
    right: -RING_WIDTH,
    borderRadius: scale(16) + RING_WIDTH,
    borderWidth: RING_WIDTH,
    borderColor: "rgba(255,255,255,0.88)",
  },
  chip: {
    position: "absolute",
    top: scale(12),
    right: scale(12),
    maxWidth: HOME_CARD_WIDTH - scale(24),
    paddingHorizontal: scale(10),
    paddingVertical: scale(4),
    borderRadius: scale(8),
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  chipText: {
    fontFamily: "System",
    fontSize: Math.round(scale(16)),
    fontWeight: "600",
    color: WATCH_THEME.text,
  },

  // ── Labels below the art ──
  meta: {
    paddingTop: scale(12),
    paddingHorizontal: scale(4),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "600",
    letterSpacing: -scale(0.2),
    color: "rgba(255,255,255,0.85)",
  },
  titleFocused: {
    color: WATCH_THEME.text,
  },
  kind: {
    fontFamily: "System",
    fontSize: Math.round(scale(17)),
    fontWeight: "500",
    color: "rgba(255,255,255,0.45)",
    marginTop: scale(3),
  },
})
