import { LinearGradient } from "expo-linear-gradient"
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import type { NavigationCarouselSection } from "../../lib/sectionModels"
import { useSectionNav } from "./SectionNavContext"

const HORIZONTAL_PADDING = 16
const CARD_GAP = 12
const CARD_ASPECT_RATIO = 1.2

export interface NavigationCarouselRendererProps {
  section: NavigationCarouselSection
}

export function NavigationCarouselRenderer({
  section,
}: NavigationCarouselRendererProps) {
  const { width: screenWidth } = useWindowDimensions()
  const { scrollToSection } = useSectionNav()

  const cardWidth = (screenWidth - HORIZONTAL_PADDING * 2) * 0.6
  const cardHeight = cardWidth * CARD_ASPECT_RATIO
  const snapInterval = cardWidth + CARD_GAP

  if (section.items.length === 0) return null

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        snapToInterval={snapInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        accessibilityRole="adjustable"
        accessibilityLabel={`${section.items.length} navigation items`}
      >
        {section.items.map((item, index) => (
          <Pressable
            key={`${item.contentId}-${item.id}-${index}`}
            onPress={() => scrollToSection(item.contentId)}
            accessibilityLabel={`${item.category ?? ""} ${item.title}`.trim()}
            accessibilityHint="Scrolls to this section"
            style={({ pressed }) => [
              styles.card,
              { width: cardWidth, height: cardHeight },
              pressed && styles.cardPressed,
            ]}
          >
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: item.backgroundColor ?? "#1A1815",
                  borderRadius: 12,
                },
              ]}
            />
            {item.imageUrl != null && (
              <Image
                source={{ uri: item.imageUrl }}
                style={[StyleSheet.absoluteFill, styles.cardImage]}
                resizeMode="cover"
              />
            )}
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.7)"]}
              style={[StyleSheet.absoluteFill, styles.cardImage]}
            />
            <View style={styles.cardContent}>
              {item.category != null && (
                <Text style={styles.category}>
                  {item.category.toUpperCase()}
                </Text>
              )}
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardImage: {
    borderRadius: 12,
  },
  cardContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 14,
  },
  category: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.8)",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    lineHeight: 20,
  },
})
