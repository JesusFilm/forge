import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { useTypography } from "../../hooks/useTypography"
import type {
  MediaCollectionItem,
  MediaCollectionSection,
} from "../../lib/sectionModels"
import { useNavigateLink } from "../../lib/useNavigateLink"
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
  const typography = useTypography()
  const thumbnailUrl = item.imageOverride?.url ?? item.video?.image?.url ?? null
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
  const onNavigate = useNavigateLink()
  const { scrollToSection } = useSectionNav()
  const typography = useTypography()

  const handleCtaPress = () => {
    if (ctaLink == null) return
    onNavigate(ctaLink)
  }

  const getItemPress = (item: MediaCollectionItem) => {
    if (item.linkToSectionKey) {
      return () => scrollToSection(item.linkToSectionKey!)
    }
    return undefined
  }

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
      {description != null && (
        <Text
          style={[
            styles.description,
            typography.bodySmall,
            isOnDark && styles.descriptionLight,
          ]}
        >
          {description}
        </Text>
      )}

      {items.length > 0 &&
        renderItems(variant, items, showNumbers, getItemPress, isOnDark)}

      {ctaLink != null && (
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
        <Text style={[styles.footerText, typography.caption]}>
          {footerText}
        </Text>
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carouselContent}
          accessibilityLabel={`${items.length} items`}
        >
          {items.map((item, i) => (
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
        <View style={styles.collectionList}>
          {items.map((item, i) => (
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
