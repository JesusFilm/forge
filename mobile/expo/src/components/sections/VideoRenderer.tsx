import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native"

import type { VideoSection } from "../../lib/sectionModels"

export interface VideoRendererProps {
  section: VideoSection
}

export function VideoRenderer({ section }: VideoRendererProps) {
  const { title, subtitle, streamingUrl, media, video } = section
  const thumbnailUrl = media?.url ?? video?.image?.url ?? null
  const thumbnailAlt =
    media?.alternativeText ?? video?.image?.alternativeText ?? title ?? "Video"

  const handlePress = () => {
    if (streamingUrl) {
      void Linking.openURL(streamingUrl)
    }
  }

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error React 19 vs RN component types */}
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.thumbnailContainer,
          pressed && styles.thumbnailPressed,
        ]}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`Play ${title ?? "video"}`}
      >
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
        {/* @ts-expect-error React 19 vs RN component types */}
        <View style={styles.playButtonOverlay}>
          {/* @ts-expect-error RN Text vs React 19 ReactNode */}
          <Text style={styles.playIcon} accessibilityElementsHidden>
            ▶
          </Text>
        </View>
      </Pressable>
      {title != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      )}
      {subtitle != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  thumbnailContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1c1917",
    justifyContent: "center",
    alignItems: "center",
  },
  thumbnailPressed: {
    opacity: 0.85,
  },
  thumbnail: {
    ...StyleSheet.absoluteFillObject,
  },
  thumbnailPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#292524",
  },
  playButtonOverlay: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    fontSize: 22,
    color: "#ffffff",
    marginLeft: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: "#666666",
    marginTop: 4,
  },
})
