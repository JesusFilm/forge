import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native"

import type { CardSection } from "../../lib/sectionModels"

export interface CardRendererProps {
  section: CardSection
}

export function CardRenderer({ section }: CardRendererProps) {
  const { title, description, media, link, variant } = section
  const isFeatured = variant === "featured"

  const handlePress = async () => {
    if (link == null) return
    try {
      await Linking.openURL(link)
    } catch {
      console.warn(`CardRenderer: failed to open URL "${link}"`)
    }
  }

  const content = (
    // @ts-expect-error React 19 vs RN component types
    <View style={[styles.card, isFeatured && styles.cardFeatured]}>
      {media != null && (
        // @ts-expect-error React 19 vs RN component types
        <Image
          source={{ uri: media.url }}
          style={[styles.image, isFeatured && styles.imageFeatured]}
          resizeMode="cover"
          accessibilityLabel={media.alternativeText ?? title}
        />
      )}
      {/* @ts-expect-error React 19 vs RN component types */}
      <View style={styles.textContainer}>
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        <Text
          style={[styles.title, isFeatured && styles.titleFeatured]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        <Text style={styles.description} numberOfLines={3}>
          {description}
        </Text>
      </View>
    </View>
  )

  if (link) {
    return (
      // @ts-expect-error React 19 vs RN component types
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.container,
          pressed && styles.pressed,
        ]}
        onPress={handlePress}
        accessibilityRole="link"
        accessibilityLabel={title}
      >
        {content}
      </Pressable>
    )
  }

  // @ts-expect-error React 19 vs RN component types
  return <View style={styles.container}>{content}</View>
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  pressed: {
    opacity: 0.85,
  },
  card: {
    borderRadius: 12,
    backgroundColor: "#ffffff",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardFeatured: {
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  image: {
    width: "100%",
    height: 180,
  },
  imageFeatured: {
    height: 240,
  },
  textContainer: {
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 6,
  },
  titleFeatured: {
    fontSize: 22,
    fontWeight: "700",
  },
  description: {
    fontSize: 14,
    color: "#666666",
    lineHeight: 20,
  },
})
