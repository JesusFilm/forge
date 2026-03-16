import { Image, Pressable, StyleSheet, Text, View } from "react-native"

import type { CardSection } from "../../lib/sectionModels"
import { useNavigateLink } from "../../lib/useNavigateLink"

export interface CardRendererProps {
  section: CardSection
}

export function CardRenderer({ section }: CardRendererProps) {
  const { title, description, media, link, variant } = section
  const isFeatured = variant === "featured"
  const onNavigate = useNavigateLink()

  const handlePress = () => {
    if (link == null) return
    onNavigate(link)
  }

  const content = (
    <View style={[styles.card, isFeatured && styles.cardFeatured]}>
      {media != null && (
        <Image
          source={{ uri: media.url }}
          style={[styles.image, isFeatured && styles.imageFeatured]}
          resizeMode="cover"
          accessibilityLabel={media.alternativeText ?? title}
        />
      )}
      <View style={styles.textContainer}>
        <Text
          style={[styles.title, isFeatured && styles.titleFeatured]}
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text style={styles.description} numberOfLines={3}>
          {description}
        </Text>
      </View>
    </View>
  )

  if (link) {
    return (
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.container,
          pressed && styles.pressed,
        ]}
        onPress={handlePress}
        accessibilityRole="link"
        accessibilityLabel={
          description.length > 0 ? `${title}. ${description}` : title
        }
        accessibilityHint="Opens link"
      >
        {content}
      </Pressable>
    )
  }

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
