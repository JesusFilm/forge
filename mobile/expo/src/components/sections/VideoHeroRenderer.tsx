import {
  ImageBackground,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"

import type { VideoHeroSection } from "../../lib/sectionModels"

export interface VideoHeroRendererProps {
  section: VideoHeroSection
}

export function VideoHeroRenderer({ section }: VideoHeroRendererProps) {
  const { heading, subheading, ctaLabel, ctaLink, video } = section
  const thumbnailUrl = video.image?.url ?? null

  const handleCtaPress = () => {
    if (ctaLink) {
      void Linking.openURL(ctaLink)
    }
  }

  const content = (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.overlay}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      {heading != null && (
        <Text
          style={styles.heading}
          accessibilityRole="header"
          numberOfLines={3}
        >
          {heading}
        </Text>
      )}
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      {subheading != null && (
        <Text style={styles.subheading} numberOfLines={2}>
          {subheading}
        </Text>
      )}
      {ctaLabel != null && ctaLink != null && (
        // @ts-expect-error React 19 vs RN component types
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
          ]}
          onPress={handleCtaPress}
          accessibilityRole="link"
          accessibilityLabel={ctaLabel}
        >
          {/* @ts-expect-error RN Text vs React 19 ReactNode */}
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </Pressable>
      )}
    </View>
  )

  if (thumbnailUrl) {
    return (
      // @ts-expect-error React 19 vs RN component types
      <ImageBackground
        source={{ uri: thumbnailUrl }}
        style={styles.container}
        resizeMode="cover"
        accessibilityLabel={
          video.image?.alternativeText ?? `${video.title} thumbnail`
        }
      >
        {content}
      </ImageBackground>
    )
  }

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={[styles.container, styles.fallbackBackground]}>{content}</View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minHeight: 400,
    justifyContent: "flex-end",
  },
  fallbackBackground: {
    backgroundColor: "#1c1917",
  },
  overlay: {
    padding: 24,
    paddingBottom: 32,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  heading: {
    fontSize: 32,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  subheading: {
    fontSize: 14,
    fontWeight: "400",
    color: "rgba(255, 255, 255, 0.7)",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginTop: 4,
  },
  ctaButton: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  ctaButtonPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
})
