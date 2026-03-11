import {
  FlatList,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import type {
  MediaCollectionItem,
  MediaCollectionSection,
} from "../../lib/sectionModels"
import { useSectionColorScheme } from "./SectionColorSchemeContext"
import { useSectionNav } from "./SectionNavContext"

export interface MediaCollectionRendererProps {
  section: MediaCollectionSection
}

function MediaItemCard({
  item,
  index,
  showNumber,
  large,
  onPress,
  isOnDark,
}: {
  item: MediaCollectionItem
  index: number
  showNumber: boolean
  large?: boolean
  onPress?: () => void
  isOnDark?: boolean
}) {
  const thumbnailUrl = item.imageOverride?.url ?? item.video?.image?.url ?? null
  const thumbnailAlt =
    item.imageOverride?.alternativeText ??
    item.video?.image?.alternativeText ??
    itemTitle(item)
  const title = itemTitle(item)
  const subtitle = item.subtitleOverride
  const hasVideo = item.video != null

  const card = (
    // @ts-expect-error React 19 vs RN component types
    <View
      style={[styles.itemCard, large && styles.itemCardLarge]}
      accessibilityLabel={title}
    >
      {/* @ts-expect-error React 19 vs RN component types */}
      <View style={[styles.thumbnailContainer, large && styles.thumbnailLarge]}>
        {thumbnailUrl ? (
          // @ts-expect-error React 19 vs RN component types
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.thumbnail}
            resizeMode="cover"
            accessibilityLabel={thumbnailAlt}
          />
        ) : (
          // @ts-expect-error React 19 vs RN component types
          <View style={styles.thumbnailPlaceholder} />
        )}
        {hasVideo && (
          // @ts-expect-error React 19 vs RN component types
          <View style={styles.playIconOverlay}>
            {/* @ts-expect-error RN Text vs React 19 ReactNode */}
            <Text style={styles.playIcon}>▶</Text>
          </View>
        )}
        {showNumber && (
          // @ts-expect-error React 19 vs RN component types
          <View style={styles.numberBadge}>
            {/* @ts-expect-error RN Text vs React 19 ReactNode */}
            <Text style={styles.numberText}>{index + 1}</Text>
          </View>
        )}
        {item.collectionSize != null && (
          // @ts-expect-error React 19 vs RN component types
          <View style={styles.sizeBadge}>
            {/* @ts-expect-error RN Text vs React 19 ReactNode */}
            <Text style={styles.sizeText}>{item.collectionSize}</Text>
          </View>
        )}
      </View>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text
        style={[styles.itemTitle, isOnDark && styles.itemTitleLight]}
        numberOfLines={2}
      >
        {title}
      </Text>
      {subtitle != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text
          style={[styles.itemSubtitle, isOnDark && styles.itemSubtitleLight]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      )}
    </View>
  )

  if (onPress) {
    return (
      // @ts-expect-error React 19 vs RN component types
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

function itemTitle(item: MediaCollectionItem): string {
  return item.titleOverride ?? item.video?.title ?? "Untitled"
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
  const { scrollToSection } = useSectionNav()

  const handleCtaPress = async () => {
    if (ctaLink == null) return
    try {
      await Linking.openURL(ctaLink)
    } catch {
      console.warn(`MediaCollectionRenderer: failed to open URL "${ctaLink}"`)
    }
  }

  const getItemPress = (item: MediaCollectionItem) => {
    if (item.linkToSectionKey) {
      return () => scrollToSection(item.linkToSectionKey!)
    }
    return undefined
  }

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {categoryLabel != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text
          style={[styles.categoryLabel, isOnDark && styles.categoryLabelLight]}
        >
          {categoryLabel}
        </Text>
      )}
      {title != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text
          style={[styles.title, isOnDark && styles.titleLight]}
          accessibilityRole="header"
        >
          {title}
        </Text>
      )}
      {subtitle != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={[styles.subtitle, isOnDark && styles.subtitleLight]}>
          {subtitle}
        </Text>
      )}
      {description != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={[styles.description, isOnDark && styles.descriptionLight]}>
          {description}
        </Text>
      )}

      {items.length > 0 &&
        renderItems(variant, items, showNumbers, getItemPress, isOnDark)}

      {ctaLink != null && (
        // @ts-expect-error React 19 vs RN component types
        <Pressable
          style={styles.ctaLink}
          onPress={handleCtaPress}
          accessibilityRole="link"
          accessibilityLabel="View more"
        >
          {/* @ts-expect-error RN Text vs React 19 ReactNode */}
          <Text style={styles.ctaLinkText}>View All →</Text>
        </Pressable>
      )}
      {footerText != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.footerText}>{footerText}</Text>
      )}
    </View>
  )
}

function renderItems(
  variant: MediaCollectionSection["variant"],
  items: MediaCollectionItem[],
  showNumbers: boolean,
  getItemPress: (item: MediaCollectionItem) => (() => void) | undefined,
  isOnDark?: boolean,
): React.ReactNode {
  switch (variant) {
    case "carousel":
      return (
        // @ts-expect-error React 19 vs RN component types
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carouselContent}
          accessibilityLabel={`${items.length} items`}
        >
          {items.map((item, i) => (
            // @ts-expect-error React 19 vs RN component types
            <View key={item.id} style={styles.carouselItem}>
              <MediaItemCard
                item={item}
                index={i}
                showNumber={showNumbers}
                onPress={getItemPress(item)}
                isOnDark={isOnDark}
              />
            </View>
          ))}
        </ScrollView>
      )

    case "grid":
      return (
        // @ts-expect-error React 19 vs RN component types
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
            // @ts-expect-error React 19 vs RN component types
            <View style={styles.gridItem}>
              <MediaItemCard
                item={item}
                index={index}
                showNumber={showNumbers}
                onPress={getItemPress(item)}
                isOnDark={isOnDark}
              />
            </View>
          )}
        />
      )

    case "hero":
      return (
        <MediaItemCard
          item={items[0]}
          index={0}
          showNumber={false}
          large
          onPress={getItemPress(items[0])}
          isOnDark={isOnDark}
        />
      )

    case "player":
      return (
        <MediaItemCard
          item={items[0]}
          index={0}
          showNumber={false}
          large
          onPress={getItemPress(items[0])}
          isOnDark={isOnDark}
        />
      )

    case "collection":
    default:
      return (
        // @ts-expect-error React 19 vs RN component types
        <View style={styles.collectionList}>
          {items.map((item, i) => (
            // @ts-expect-error React 19 vs RN component types
            <View key={item.id} style={styles.collectionItem}>
              <MediaItemCard
                item={item}
                index={i}
                showNumber={showNumbers}
                onPress={getItemPress(item)}
                isOnDark={isOnDark}
              />
            </View>
          ))}
        </View>
      )
  }
}

const CAROUSEL_ITEM_WIDTH = 200

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingVertical: 16,
  },
  categoryLabel: {
    fontSize: 12,
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
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
    paddingHorizontal: 24,
    marginBottom: 4,
  },
  titleLight: {
    color: "#ffffff",
  },
  subtitle: {
    fontSize: 16,
    color: "#666666",
    paddingHorizontal: 24,
    marginBottom: 4,
  },
  subtitleLight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  description: {
    fontSize: 14,
    color: "#4a4a4a",
    lineHeight: 20,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  descriptionLight: {
    color: "rgba(255, 255, 255, 0.85)",
  },
  // Carousel
  carouselContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  carouselItem: {
    width: CAROUSEL_ITEM_WIDTH,
  },
  // Grid
  gridRow: {
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  gridItem: {
    flex: 1,
  },
  // Collection (vertical)
  collectionList: {
    paddingHorizontal: 16,
  },
  collectionItem: {
    marginBottom: 16,
  },
  // Item card
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
    fontSize: 16,
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
    fontSize: 13,
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
    fontSize: 11,
    color: "#ffffff",
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 8,
  },
  itemTitleLight: {
    color: "#ffffff",
  },
  itemSubtitle: {
    fontSize: 12,
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
    fontSize: 14,
    fontWeight: "600",
    color: "#1a73e8",
  },
  footerText: {
    fontSize: 12,
    color: "#999999",
    paddingHorizontal: 24,
    marginTop: 8,
  },
})
