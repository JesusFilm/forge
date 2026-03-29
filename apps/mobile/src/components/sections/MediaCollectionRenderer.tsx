import React from "react"
import { LinearGradient } from "expo-linear-gradient"
import {
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import { hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import type {
  MediaCollectionItem,
  MediaCollectionSection,
} from "../../lib/sectionModels"
import { useNavigateLink } from "../../lib/useNavigateLink"
import { useSectionColorScheme } from "./SectionColorSchemeContext"
import { useSectionNav } from "./SectionNavContext"

// ── Constants ────────────────────────────────────────────────────────────────

const CAROUSEL_CARD_GAP = 12
const CAROUSEL_HORIZONTAL_PADDING = 24
const CAROUSEL_CARD_ASPECT_RATIO = 3 / 4
const CAROUSEL_CARD_WIDTH_RATIO = 0.42
const CAROUSEL_CARD_MAX_WIDTH = 240
const CAROUSEL_MAX_ITEMS = 25

const GRADIENT_COLORS: [string, string] = [
  hexToRgba("#000000", 0),
  hexToRgba("#000000", 0.85),
]
const GRADIENT_LOCATIONS: [number, number] = [0, 0.55]

// ── Overlay card for carousel variant ────────────────────────────────────────

const OverlayMediaCard = React.memo(function OverlayMediaCard({
  item,
  cardWidth,
  categoryLabel,
  typography,
  onPress,
}: {
  item: MediaCollectionItem
  cardWidth: number
  categoryLabel: string | null
  typography: TypographyScale
  onPress?: () => void
}) {
  const title = itemTitle(item)
  const label = item.labelOverride ?? categoryLabel
  const thumbnailUrl = resolveImageUrl(
    item.imageOverride?.url ?? item.video?.image?.url ?? item.imageUrl,
  )

  return (
    <Pressable
      style={({ pressed }) => [
        styles.overlayCard,
        { width: cardWidth },
        pressed && Platform.OS === "ios" && styles.overlayCardPressed,
      ]}
      android_ripple={{ color: "rgba(255,255,255,0.3)", foreground: true }}
      onPress={onPress}
      accessibilityLabel={`${label ?? ""} ${title}`.trim()}
      accessibilityHint="Opens this video"
    >
      <View
        style={[
          styles.overlayCardInner,
          { aspectRatio: CAROUSEL_CARD_ASPECT_RATIO },
        ]}
      >
        {thumbnailUrl != null && (
          <Image
            source={{ uri: thumbnailUrl }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        )}

        <LinearGradient
          colors={GRADIENT_COLORS}
          locations={GRADIENT_LOCATIONS}
          style={styles.overlayGradient}
          pointerEvents="none"
        />

        {item.collectionSize != null && (
          <View
            style={styles.overlayBadge}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={[styles.overlayBadgeText, typography.caption]}>
              {item.collectionSize}
            </Text>
          </View>
        )}

        <View style={styles.overlayTextContainer}>
          {label != null && (
            <Text style={[styles.overlayCategoryLabel, typography.caption]}>
              {label}
            </Text>
          )}
          <Text
            style={[styles.overlayTitle, typography.bodySmall]}
            numberOfLines={2}
          >
            {title}
          </Text>
        </View>
      </View>
    </Pressable>
  )
})

// ── Existing card for non-carousel variants ──────────────────────────────────

function MediaItemCard({
  item,
  index,
  showNumber,
  large,
  onPress,
  isOnDark,
  typography,
}: {
  item: MediaCollectionItem
  index: number
  showNumber: boolean
  large?: boolean
  onPress?: () => void
  isOnDark?: boolean
  typography: TypographyScale
}) {
  const thumbnailUrl = resolveImageUrl(
    item.imageOverride?.url ?? item.video?.image?.url ?? item.imageUrl,
  )
  const thumbnailAlt =
    item.imageOverride?.alternativeText ??
    item.video?.image?.alternativeText ??
    itemTitle(item)
  const title = itemTitle(item)
  const subtitle = item.subtitleOverride
  const hasVideo = item.video != null

  const card = (
    <View
      style={[styles.itemCard, large && styles.itemCardLarge]}
      accessibilityLabel={title}
    >
      <View style={[styles.thumbnailContainer, large && styles.thumbnailLarge]}>
        {thumbnailUrl ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.thumbnail}
            resizeMode="cover"
            accessibilityLabel={thumbnailAlt}
          />
        ) : (
          <View style={styles.thumbnailPlaceholder} />
        )}
        {hasVideo && (
          <View style={styles.playIconOverlay}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        )}
        {showNumber && (
          <View style={styles.numberBadge}>
            <Text style={styles.numberText}>{index + 1}</Text>
          </View>
        )}
        {item.collectionSize != null && (
          <View style={styles.sizeBadge}>
            <Text style={styles.sizeText}>{item.collectionSize}</Text>
          </View>
        )}
      </View>
      <Text
        style={[
          styles.itemTitle,
          typography.bodySmall,
          isOnDark && styles.itemTitleLight,
        ]}
        numberOfLines={2}
      >
        {title}
      </Text>
      {subtitle != null && (
        <Text
          style={[
            styles.itemSubtitle,
            typography.caption,
            isOnDark && styles.itemSubtitleLight,
          ]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      )}
    </View>
  )

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }: { pressed: boolean }) => [
          pressed && styles.itemPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Navigate to ${title}`}
      >
        {card}
      </Pressable>
    )
  }

  return card
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function itemTitle(item: MediaCollectionItem): string {
  return item.titleOverride ?? item.video?.title ?? "Untitled"
}

// ── Main component ───────────────────────────────────────────────────────────

export interface MediaCollectionRendererProps {
  section: MediaCollectionSection
}

export function MediaCollectionRenderer({
  section,
}: MediaCollectionRendererProps) {
  const {
    title,
    subtitle,
    description,
    categoryLabel,
    ctaLink,
    showItemNumbers,
    footerText,
    variant,
    items,
  } = section

  const colorScheme = useSectionColorScheme()
  const isOnDark = colorScheme === "light"
  const showNumbers = showItemNumbers === true
  const onNavigate = useNavigateLink()
  const { scrollToSection } = useSectionNav()
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()

  const handleCtaPress = () => {
    if (ctaLink == null) return
    onNavigate(ctaLink)
  }

  const getItemPress = (item: MediaCollectionItem) => {
    const key = item.linkToSectionKey
    if (key) {
      return () => scrollToSection(key)
    }
    return undefined
  }

  const isCarousel = variant === "carousel"

  // Responsive card width for the carousel variant
  const carouselCardWidth = Math.min(
    Math.round(screenWidth * CAROUSEL_CARD_WIDTH_RATIO),
    CAROUSEL_CARD_MAX_WIDTH,
  )
  const carouselSnapInterval = carouselCardWidth + CAROUSEL_CARD_GAP

  return (
    <View style={styles.container}>
      {categoryLabel != null && (
        <Text
          style={[
            styles.categoryLabel,
            typography.caption,
            isOnDark && styles.categoryLabelLight,
          ]}
        >
          {categoryLabel}
        </Text>
      )}
      {title != null && (
        <Text
          style={[
            styles.title,
            typography.heading,
            isOnDark && styles.titleLight,
          ]}
          accessibilityRole="header"
        >
          {title}
        </Text>
      )}
      {subtitle != null && (
        <Text
          style={[
            styles.subtitle,
            typography.body,
            isOnDark && styles.subtitleLight,
          ]}
        >
          {subtitle}
        </Text>
      )}

      {/* WATCH button — carousel variant only */}
      {isCarousel && (
        <Pressable
          style={styles.watchButton}
          onPress={() => Linking.openURL("https://www.jesusfilm.org/watch")}
          accessibilityLabel="Watch"
          accessibilityRole="link"
        >
          <View
            style={styles.watchButtonIconContainer}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.watchButtonIcon}>▶</Text>
          </View>
          <Text style={[styles.watchButtonText, typography.bodySmall]}>
            WATCH
          </Text>
        </Pressable>
      )}

      {description != null && (
        <Text
          style={[
            styles.description,
            typography.body,
            isOnDark && styles.descriptionLight,
          ]}
        >
          {description}
        </Text>
      )}

      {/* Carousel variant — overlay cards */}
      {isCarousel && items.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={carouselSnapInterval}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          accessibilityRole="adjustable"
          accessibilityLabel={`${items.length} items`}
          contentContainerStyle={{
            paddingHorizontal: CAROUSEL_HORIZONTAL_PADDING,
            gap: CAROUSEL_CARD_GAP,
          }}
        >
          {items.slice(0, CAROUSEL_MAX_ITEMS).map((item, index) => (
            <OverlayMediaCard
              key={`mediaCollection-${item.id}-${index}`}
              item={item}
              cardWidth={carouselCardWidth}
              categoryLabel={categoryLabel}
              typography={typography}
              onPress={getItemPress(item)}
            />
          ))}
        </ScrollView>
      )}

      {/* Non-carousel variants — existing cards */}
      {!isCarousel &&
        items.length > 0 &&
        renderItems(
          variant,
          items,
          showNumbers,
          getItemPress,
          isOnDark,
          typography,
        )}

      {ctaLink != null && !isCarousel && (
        <Pressable
          style={styles.ctaLink}
          onPress={handleCtaPress}
          accessibilityRole="link"
          accessibilityLabel="View more"
        >
          <Text style={[styles.ctaLinkText, typography.bodySmall]}>
            View All →
          </Text>
        </Pressable>
      )}
      {footerText != null && (
        <Text style={[styles.footerText, typography.body]}>{footerText}</Text>
      )}
    </View>
  )
}

// ── Render helpers for non-carousel variants ─────────────────────────────────

function renderItems(
  variant: MediaCollectionSection["variant"],
  items: MediaCollectionItem[],
  showNumbers: boolean,
  getItemPress: (item: MediaCollectionItem) => (() => void) | undefined,
  isOnDark: boolean | undefined,
  typography: TypographyScale,
): React.ReactNode {
  switch (variant) {
    case "grid":
      return (
        <FlatList
          data={items}
          keyExtractor={(item: MediaCollectionItem) => item.id}
          numColumns={2}
          scrollEnabled={false}
          columnWrapperStyle={styles.gridRow}
          renderItem={({
            item,
            index,
          }: {
            item: MediaCollectionItem
            index: number
          }) => (
            <View style={styles.gridItem}>
              <MediaItemCard
                item={item}
                index={index}
                showNumber={showNumbers}
                onPress={getItemPress(item)}
                isOnDark={isOnDark}
                typography={typography}
              />
            </View>
          )}
        />
      )

    case "hero":
    case "player":
      return (
        <MediaItemCard
          item={items[0]}
          index={0}
          showNumber={false}
          large
          onPress={getItemPress(items[0])}
          isOnDark={isOnDark}
          typography={typography}
        />
      )

    case "collection":
    default:
      return (
        <View style={styles.collectionList}>
          {items.map((item, i) => (
            <View key={item.id} style={styles.collectionItem}>
              <MediaItemCard
                item={item}
                index={i}
                showNumber={showNumbers}
                onPress={getItemPress(item)}
                isOnDark={isOnDark}
                typography={typography}
              />
            </View>
          ))}
        </View>
      )
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingVertical: 16,
  },
  categoryLabel: {
    fontWeight: "600",
    color: "#1a73e8",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 24,
    marginBottom: 4,
  },
  categoryLabelLight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  title: {
    fontWeight: "700",
    color: "#1a1a1a",
    paddingHorizontal: 24,
    marginBottom: 4,
  },
  titleLight: {
    color: "#ffffff",
  },
  subtitle: {
    color: "#666666",
    paddingHorizontal: 24,
    marginBottom: 4,
  },
  subtitleLight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  description: {
    color: "#4a4a4a",
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  descriptionLight: {
    color: "rgba(255, 255, 255, 0.85)",
  },

  // ── WATCH button ─────────────────────────────────────────────────────────
  watchButton: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.5)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignSelf: "flex-start",
    marginLeft: 24,
    marginTop: 8,
    marginBottom: 12,
  },
  watchButtonIconContainer: {
    marginRight: 6,
  },
  watchButtonIcon: {
    color: "#FFFFFF",
    fontSize: 10, // Icon size — intentionally excluded from typography scale
  },
  watchButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  // ── Overlay card (carousel variant) ──────────────────────────────────────
  overlayCard: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
  },
  overlayCardPressed: {
    opacity: 0.8,
  },
  overlayCardInner: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
  },
  overlayGradient: {
    ...StyleSheet.absoluteFillObject,
    top: "40%",
  },
  overlayBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  overlayBadgeText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  overlayTextContainer: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
  },
  overlayCategoryLabel: {
    color: "rgba(255, 255, 255, 0.95)",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  overlayTitle: {
    color: "#FFFFFF",
    fontWeight: "700",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // ── Grid ─────────────────────────────────────────────────────────────────
  gridRow: {
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  gridItem: {
    flex: 1,
  },

  // ── Collection (vertical) ────────────────────────────────────────────────
  collectionList: {
    paddingHorizontal: 16,
  },
  collectionItem: {
    marginBottom: 16,
  },

  // ── Item card (non-carousel variants) ────────────────────────────────────
  itemCard: {
    // base card style
  },
  itemCardLarge: {
    paddingHorizontal: 16,
  },
  itemPressed: {
    opacity: 0.7,
  },
  thumbnailContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#e5e5e5",
  },
  thumbnailLarge: {
    aspectRatio: 16 / 9,
    borderRadius: 12,
  },
  thumbnail: {
    ...StyleSheet.absoluteFillObject,
  },
  thumbnailPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#d4d4d4",
  },
  playIconOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    color: "#ffffff",
    fontSize: 16, // Icon/badge size — intentionally excluded from typography scale
    textAlign: "center",
    lineHeight: 40,
    overflow: "hidden",
  },
  numberBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  numberText: {
    fontSize: 13, // Icon/badge size — intentionally excluded from typography scale
    fontWeight: "700",
    color: "#ffffff",
  },
  sizeBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  sizeText: {
    fontSize: 11, // Icon/badge size — intentionally excluded from typography scale
    color: "#ffffff",
  },
  itemTitle: {
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 8,
  },
  itemTitleLight: {
    color: "#ffffff",
  },
  itemSubtitle: {
    color: "#666666",
    marginTop: 2,
  },
  itemSubtitleLight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  ctaLink: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    marginTop: 8,
  },
  ctaLinkText: {
    fontWeight: "600",
    color: "#1a73e8",
  },
  footerText: {
    color: "#999999",
    paddingHorizontal: 24,
    marginTop: 8,
  },
})
