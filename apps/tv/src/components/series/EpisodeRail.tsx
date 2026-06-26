// Below-fold horizontal D-pad rail of the series' children (U3). Routes by shape
// (episodeRouting): leaf → /watch, nested collection → /series, both seeded. Nothing
// when childless. Mirrors UpNextRail + getItemLayout (fixed dims) to virtualize.

import { memo, useCallback, useMemo } from "react"
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from "react-native"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"

import type { WatchEpisode } from "../../lib/normalizeVideo"
import { isSeriesLabel } from "../../lib/isSeriesRecord"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { scale } from "../../lib/scale"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SECTION_HEADING } from "../sections/sectionHeading"
import {
  focusTransform,
  THUMB_SHADOW,
  useFocusAnimation,
  useThumbFocusRing,
} from "../watch/useFocusAnimation"
import { episodeHref, resolveEpisodePath } from "./episodeRouting"

const CARD_WIDTH = scale(360)
const THUMB_HEIGHT = scale(168.75) // 32:15 (2.13:1), matches UpNextRail
const ITEM_GAP = scale(30)

const keyExtractor = (item: WatchEpisode, index: number) =>
  `episode-${item.documentId}-${index}`

// Fixed card dims → no measuring pass. The last item has no trailing gap, so
// its length is overstated by ITEM_GAP — harmless for virtualization and
// scrollToIndex. Module-scope: pure function of module constants.
const getItemLayout = (
  _: ArrayLike<WatchEpisode> | null | undefined,
  index: number,
) => ({
  length: CARD_WIDTH + ITEM_GAP,
  offset: (CARD_WIDTH + ITEM_GAP) * index,
  index,
})

type EpisodeRailProps = {
  episodes: WatchEpisode[]
  /** Selected language slug, threaded into the pushed route's `lang` param (U4 provider supplies + consumes it). */
  languageSlug?: string | null
  /** Replaces the default push-by-shape routing when provided. */
  onEpisodePress?: (episode: WatchEpisode) => void
}

export const EpisodeRail = memo(function EpisodeRail({
  episodes,
  languageSlug,
  onEpisodePress,
}: EpisodeRailProps) {
  const router = useRouter()

  const handlePress = useCallback(
    (episode: WatchEpisode) => {
      if (onEpisodePress != null) {
        onEpisodePress(episode)
        return
      }
      router.push(episodeHref(resolveEpisodePath(episode, { languageSlug })))
    },
    [router, onEpisodePress, languageSlug],
  )

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<WatchEpisode>) => (
      <View
        style={[
          styles.itemWrapper,
          index < episodes.length - 1 && styles.itemGap,
        ]}
      >
        {/* EpisodeCard re-emits its `episode` prop from onPress — never
            re-index into `data` from an async focus/press callback (the
            array can shrink under it). */}
        <EpisodeCard episode={item} index={index} onPress={handlePress} />
      </View>
    ),
    [episodes.length, handlePress],
  )

  if (episodes.length === 0) return null

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.headTitle} accessibilityRole="header">
          Episodes
        </Text>
        <Text style={styles.headCount}>
          {episodes.length === 1 ? "1 episode" : `${episodes.length} episodes`}
        </Text>
      </View>

      <TVFocusGuideView autoFocus>
        <FlatList
          data={episodes}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={keyExtractor}
          onScrollToIndexFailed={() => {}}
          getItemLayout={getItemLayout}
          renderItem={renderItem}
        />
      </TVFocusGuideView>
    </View>
  )
})

const EpisodeCard = memo(function EpisodeCard({
  episode,
  index,
  onPress,
}: {
  episode: WatchEpisode
  index: number
  onPress: (episode: WatchEpisode) => void
}) {
  // Focus eases in (no "blink"): the card lifts + magnifies, the white ring
  // fades in, and the overlay icon fades in over ~180ms.
  const { setFocused, progress } = useFocusAnimation()
  const title = episode.title ?? episode.slug
  // A series-shaped card opens a nested collection, not a video — its eyebrow
  // shows the shape label and its focus overlay a stack icon, so the routing
  // difference is visible before the press.
  const isNestedSeries = isSeriesLabel(episode.label)
  const eyebrow = isNestedSeries
    ? (episode.label ?? "")
    : `EPISODE ${index + 1}`
  // CMS poster URL is untrusted — sanitize before it reaches expo-image.
  const poster = useMemo(
    () =>
      episode.posterUrl != null ? resolveImageUrl(episode.posterUrl) : null,
    [episode.posterUrl],
  )

  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const cardStyle = useMemo(
    () => ({
      transform: focusTransform(progress, { lift: scale(8), magnify: 1.06 }),
    }),
    [progress],
  )
  const { shadowStyle, ringStyle, ringFrame } = useThumbFocusRing(
    progress,
    CARD_WIDTH,
    THUMB_HEIGHT,
  )

  return (
    <Pressable
      onPress={() => onPress(episode)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={
        isNestedSeries ? "Opens this series" : "Opens this video"
      }
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
                recyclingKey={`episode-${episode.documentId}`}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.thumbFallback]} />
            )}
            <Animated.View style={[styles.focusOverlay, { opacity: progress }]}>
              <Ionicons
                name={isNestedSeries ? "albums" : "play"}
                size={Math.round(scale(42))}
                color={WATCH_THEME.text}
              />
            </Animated.View>
          </View>
        </Animated.View>

        {/* White focus ring hugging the thumb — matches HomeCard. */}
        <Animated.View style={[ringFrame, ringStyle]} pointerEvents="none" />

        <View style={styles.meta}>
          <Text style={styles.eyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {title}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(20),
  },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: scale(18),
    marginBottom: scale(30),
    paddingHorizontal: scale(80),
  },
  headTitle: SECTION_HEADING,
  headCount: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "500",
    color: WATCH_THEME.text50,
  },
  listContent: {
    paddingHorizontal: scale(80),
  },
  // Vertical room so the lift + focus glow + overlay never clip neighbours.
  itemWrapper: {
    paddingVertical: scale(40),
  },
  itemGap: {
    marginRight: ITEM_GAP,
  },

  card: {
    width: CARD_WIDTH,
  },
  // Neutral dark drop shadow for depth (matches HomeCard), revealed by the
  // animated opacity. On the OUTER wrapper so iOS doesn't clip it (the inner
  // thumb is overflow:hidden).
  thumbWrap: {
    width: CARD_WIDTH,
    height: THUMB_HEIGHT,
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
