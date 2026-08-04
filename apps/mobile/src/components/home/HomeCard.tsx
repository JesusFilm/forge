/**
 * Pressable poster card for the Home content shelves (landscape 16:9 / portrait
 * 3:4 variants). Routing mirrors Discover's handleSelectResult: series-shaped
 * cards open /series/[slug], else /watch/[slug], both with a watch seed.
 */
import { memo } from "react"
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import {
  WatchProgressBar,
  progressAccessibilityText,
} from "../watch/WatchProgressBar"
import { useWatchProgressEntry } from "../../hooks/useWatchProgressEntry"
import { useRouter } from "expo-router"

import { BLACK, hexToRgba, TEXT_ON_OVERLAY } from "../../lib/color"
import { datadogLog } from "../../lib/datadog"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { encodeWatchSeed } from "../../lib/watchSeed"
import { isSeriesSearchResult } from "../../lib/isSeriesRecord"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { prefetchHeroStream } from "../../hooks/useHeroStream"
import { useTypography } from "../../hooks/useTypography"
import { card as cardStyle, feedback } from "../../styles/shared"

// ── Types ───────────────────────────────────────────────────────────────────

export type HomeCardVariant = "landscape" | "portrait"

export type HomeCardProps = {
  card: WatchHomeCard
  variant: HomeCardVariant
}

// ── Constants ───────────────────────────────────────────────────────────────

const CARD_WIDTH_RATIO: Record<HomeCardVariant, number> = {
  landscape: 0.6,
  portrait: 0.37,
}

/** width / height: landscape is 16:9, portrait is 3:4. */
const CARD_ASPECT: Record<HomeCardVariant, number> = {
  landscape: 16 / 9,
  portrait: 3 / 4,
}

const GRADIENT_COLORS: [string, string] = [
  hexToRgba(BLACK, 0),
  hexToRgba(BLACK, 0.85),
]

/**
 * Rendered card width for a variant. Exported so HomeShelf's snapToInterval
 * uses the exact same number the card renders with.
 */
export function homeCardWidth(
  variant: HomeCardVariant,
  screenWidth: number,
): number {
  return Math.round(screenWidth * CARD_WIDTH_RATIO[variant])
}

// ── Component ───────────────────────────────────────────────────────────────

export const HomeCard = memo(function HomeCard({
  card,
  variant,
}: HomeCardProps) {
  const router = useRouter()
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()

  const width = homeCardWidth(variant, screenWidth)
  const imageUrl = resolveImageUrl(card.imageUrl)
  // Same series test Discover routes with: the model's display label
  // ("Series"/"Collection") lowercases into isSeriesLabel's set.
  const isSeries = isSeriesSearchResult({
    label: card.label,
    childCount: card.childCount,
  })
  // A slug-less item (curated home cards carry a null videoSlug) has nowhere to
  // navigate; render a passive card, not a button that announces + no-ops a tap.
  const interactive = !!card.slug

  const handlePressIn = () => {
    // Touch-down warm-up: the shared capped/deduped GET_VIDEO_BY_SLUG
    // prefetch (max 3 in flight, dedupe by slug) — same pool the hero pager
    // draws from, so a card press lands on a warm cache.
    prefetchHeroStream(card.slug)
  }

  const progressEntry = useWatchProgressEntry(card.id)

  const handlePress = () => {
    if (!card.slug) return
    // Carry seed data forward so the detail screen paints instantly.
    const seed = encodeWatchSeed({
      slug: card.slug,
      title: card.title,
      imageUrl: card.imageUrl,
      playbackId: card.playbackId,
    })
    const route = isSeries ? "series" : "watch"
    router.push(`/${route}/${encodeURIComponent(card.slug)}?seed=${seed}`)
  }

  return (
    <Pressable
      style={({ pressed }) => [
        cardStyle.surface,
        { width, aspectRatio: CARD_ASPECT[variant] },
        interactive && pressed && Platform.OS === "ios" && feedback.pressed,
      ]}
      android_ripple={
        interactive
          ? { color: "rgba(255, 255, 255, 0.2)", foreground: true }
          : undefined
      }
      onPressIn={interactive ? handlePressIn : undefined}
      onPress={interactive ? handlePress : undefined}
      accessibilityRole={interactive ? "button" : "image"}
      accessibilityLabel={[card.title, progressAccessibilityText(progressEntry)]
        .filter(Boolean)
        .join(", ")}
      // Stable, low-cardinality RUM action name (auto-tracker would leak the
      // title from accessibilityLabel) — KTD10. Spread: Pressable omits the type.
      {...{ "dd-action-name": "home-card" }}
      accessibilityHint={
        interactive
          ? isSeries
            ? "Opens this series"
            : "Opens this video"
          : undefined
      }
    >
      {imageUrl != null && (
        <Image
          source={imageUrl}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={card.id}
          accessibilityLabel={card.imageAlt}
          priority="low"
          onError={() =>
            datadogLog.warn("image.load_failed", { surface: "home-card" })
          }
        />
      )}
      <LinearGradient
        colors={GRADIENT_COLORS}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Meta derivation (duration m:ss|h:mm:ss / "N episodes" / label text)
          lives in the model's buildMetaLabel — consume, don't re-derive. */}
      {card.metaLabel != null && (
        <View style={cardStyle.badge}>
          <Text style={[cardStyle.badgeText, typography.caption]}>
            {card.metaLabel}
          </Text>
        </View>
      )}
      <View style={styles.textContent} pointerEvents="none">
        <Text
          style={[styles.cardTitle, typography.bodySmall]}
          numberOfLines={2}
        >
          {card.title}
        </Text>
      </View>
      <WatchProgressBar videoId={card.id} />
    </Pressable>
  )
})

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  textContent: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
  },
  cardTitle: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "700",
  },
})
