// One Home rail card: 2.13:1 thumb + metaLabel chip, fixed width (exported for
// HomeRail's getItemLayout). Focus = white ring overlay + shadow on a separate
// overflow-visible wrapper. onFocus/onPress re-emit the `card` PROP, never re-indexed from the rail's data array (patterns doc §7).

import { memo, useCallback, useMemo, useRef } from "react"
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
import {
  THUMB_SHADOW,
  useFocusVisual,
  useThumbFocusRing,
} from "../focus/useFocusVisual"
import { WATCH_THEME } from "../watch/watchDetailTheme"

export const HOME_CARD_WIDTH = scale(400)
// 32:15 (2.13:1) of the 400 width — matches the cinematic source art (400×15/32).
export const HOME_CARD_THUMB_HEIGHT = scale(187.5)

// Android runs the focus tween on the native driver (off the JS thread, the
// D-pad-move bottleneck on the weak SoC) and drops the JS shadow + hairline.
// tvOS keeps the full JS treatment.
const IS_ANDROID = Platform.OS === "android"

type HomeCardProps = {
  card: WatchHomeCard
  /** Re-emits the `card` PROP plus this card's native node, so the screen can
   *  remember the exact element to re-focus after a nav push/pop. */
  onFocus: (card: WatchHomeCard, node: ViewType | null) => void
  onPress: (card: WatchHomeCard) => void
  index: number
  /**
   * Forced D-pad-up destination (featured rail wires the Search tab here so
   * edge cards reach the centered top bar, which has no horizontal overlap
   * above them). Pressable forwards it to its host View, so a node works.
   */
  nextFocusUp?: ViewType | null
  /**
   * Exposes this card's native node. The rail captures its LAST real card's
   * node so invisible over-hang pad cards can bounce focus to it via
   * requestTVFocus(). Ref-as-state in the rail, like MissionSection.
   */
  nodeRef?: (node: ViewType | null) => void
  /**
   * Whether to load the artwork. Off-window rails (Android image-windowing)
   * pass false: the card still mounts + stays focusable, only the decode is
   * skipped — so D-pad focus never lands on an empty rail.
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
  const { focused, setFocused, progress, transform } = useFocusVisual("thumb", {
    nativeDriver: IS_ANDROID,
  })
  // Own this card's host node so onFocus can report it upward, while still
  // forwarding to nodeRef (the rail captures its LAST card for RailPad bounce).
  const localRef = useRef<ViewType | null>(null)
  const setRef = useCallback(
    (node: ViewType | null) => {
      localRef.current = node
      nodeRef?.(node)
    },
    [nodeRef],
  )
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
  const liftStyle = useMemo(() => ({ transform }), [transform])
  const { shadowStyle, ringStyle, ringFrame } = useThumbFocusRing(
    progress,
    HOME_CARD_WIDTH,
    HOME_CARD_THUMB_HEIGHT,
  )

  return (
    <Pressable
      ref={setRef}
      onPress={() => onPress(card)}
      onFocus={() => {
        setFocused(true)
        onFocus(card, localRef.current)
      }}
      onBlur={() => setFocused(false)}
      nextFocusUp={nextFocusUp}
      accessibilityRole="button"
      accessibilityLabel={card.title}
      // Stable, low-cardinality RUM action name (auto-tracker would use the title).
      {...{ "dd-action-name": "home-card" }}
      accessibilityHint={
        isSeriesShaped ? "Opens this series" : "Opens this video"
      }
      testID={`home-card-${card.id}-${index}`}
    >
      <Animated.View style={[styles.card, liftStyle]}>
        <View style={styles.thumbBox}>
          {/* Animated drop shadow on its own overflow-visible wrapper (iOS clips
              shadows on overflow:hidden). Gated off on Android — the native
              driver can't animate shadowOpacity and Android skips shadow* anyway. */}
          <Animated.View
            style={[styles.shadowWrap, IS_ANDROID ? null : shadowStyle]}
          >
            <View style={styles.thumb}>
              {imageUrl != null && loadImage ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  contentPosition="top left"
                  recyclingKey={`home-card-${card.id}`}
                  // Android only: de-prioritize decodes so they don't saturate
                  // the queue ahead of the focused card; memory-disk makes
                  // re-entry instant. tvOS keeps expo-image defaults.
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
          <Animated.View style={[ringFrame, ringStyle]} pointerEvents="none" />
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
    ...THUMB_SHADOW,
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
