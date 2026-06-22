// Up Next rail — siblings under the same parent; a card opens THAT video's details
// (R15), it does NOT play; renders nothing without siblings. Built inline (own
// FlatList) not via shared ContentRail so Home/Search keep their look.

import { useMemo } from "react"
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"

import type { WatchSibling } from "../../lib/normalizeVideo"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { scale } from "../../lib/scale"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { WATCH_THEME } from "./watchDetailTheme"
import { SECTION_HEADING } from "../sections/sectionHeading"
import { focusTransform, useFocusAnimation } from "./useFocusAnimation"

const CARD_WIDTH = scale(360)
const THUMB_HEIGHT = scale(202) // 16:9-ish, matches the mockup

export function UpNextRail({ siblings }: { siblings: WatchSibling[] }) {
  const router = useRouter()

  if (siblings.length === 0) return null

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.headTitle} accessibilityRole="header">
          Up Next
        </Text>
        <Text style={styles.headCount}>{`${siblings.length} videos`}</Text>
      </View>

      <TVFocusGuideView autoFocus>
        <FlatList
          data={siblings}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={(item) => `upnext-${item.documentId}`}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item, index }) => (
            <View
              style={[
                styles.itemWrapper,
                index < siblings.length - 1 && styles.itemGap,
              ]}
            >
              <EpisodeCard
                sibling={item}
                onPress={() =>
                  router.push(`/watch/${encodeURIComponent(item.slug)}`)
                }
              />
            </View>
          )}
        />
      </TVFocusGuideView>
    </View>
  )
}

function EpisodeCard({
  sibling,
  onPress,
}: {
  sibling: WatchSibling
  onPress: () => void
}) {
  // Focus eases in (no "blink"): the card lifts + magnifies, the white glow ramps
  // up, and the play overlay fades in over ~180ms.
  const { setFocused, progress } = useFocusAnimation()
  const title = sibling.title ?? sibling.slug
  // CMS poster URL is untrusted — sanitize before it reaches expo-image.
  const poster =
    sibling.posterUrl != null ? resolveImageUrl(sibling.posterUrl) : null

  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const cardStyle = useMemo(
    () => ({
      transform: focusTransform(progress, { lift: scale(8), magnify: 1.05 }),
    }),
    [progress],
  )
  const glowStyle = useMemo(
    () => ({
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.9],
      }),
    }),
    [progress],
  )

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="Opens this video"
    >
      <Animated.View style={[styles.card, cardStyle]}>
        {/* Glow on the outer wrapper (overflow visible); image-clipping on the
            inner view (overflow hidden). A shadow on an overflow:hidden view is
            clipped away on iOS — same outer/inner split as FocusableCard. */}
        <Animated.View style={[styles.thumbWrap, glowStyle]}>
          <View style={styles.thumb}>
            {poster != null ? (
              <Image
                source={{ uri: poster }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={`upnext-${sibling.documentId}`}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.thumbFallback]} />
            )}
            <Animated.View style={[styles.playOverlay, { opacity: progress }]}>
              <Ionicons
                name="play"
                size={Math.round(scale(42))}
                color={WATCH_THEME.text}
              />
            </Animated.View>
          </View>
        </Animated.View>

        {/* The mockup's accent eyebrow is a meaningful per-episode label ("Day 1");
            JFP siblings only carry the content-type label (e.g. "SERIES"), which
            would repeat identically on every card — so we show just the title. */}
        <View style={styles.meta}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {title}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  )
}

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
  // Vertical room so the lift + focus ring + play overlay never clip neighbours.
  itemWrapper: {
    paddingVertical: scale(40),
  },
  itemGap: {
    marginRight: scale(30),
  },

  card: {
    width: CARD_WIDTH,
  },
  // White focus glow matching the action-row buttons; shadowOpacity is animated
  // (0 at rest). On the OUTER wrapper so iOS doesn't clip it (the inner thumb is
  // overflow:hidden).
  thumbWrap: {
    width: CARD_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: scale(16),
    shadowColor: "#ffffff",
    shadowRadius: scale(10),
    shadowOffset: { width: 0, height: 0 },
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
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  meta: {
    paddingTop: scale(16),
    paddingHorizontal: scale(4),
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
