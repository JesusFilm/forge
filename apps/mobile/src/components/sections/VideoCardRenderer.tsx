import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"

import Ionicons from "@expo/vector-icons/Ionicons"

import {
  hexToRgba,
  BLACK,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
} from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { useTypography } from "../../hooks/useTypography"
import { card, feedback, overlay, text } from "../../styles/shared"
import type { NormalizedBlock } from "../../lib/normalizer"
import { pickThumbnailUrl } from "../../lib/types"
import type { VideoRef } from "../../lib/types"

// ── Types ───────────────────────────────────────────────────────────────────

export interface VideoCardRendererProps {
  section: NormalizedBlock
  index?: number
}

// ── Component ───────────────────────────────────────────────────────────────

export function VideoCardRenderer({
  section,
  index = 0,
}: VideoCardRendererProps) {
  const router = useRouter()
  const typography = useTypography()

  const title =
    (section.videoTitle as string | null) ?? (section.title as string | null)
  const subtitle =
    (section.videoSubtitle as string | null) ??
    (section.subtitle as string | null)
  const sectionKey =
    (section.sectionKey as string | null) ?? (section.id as string | null)

  const videoRef = section.videoRef as VideoRef | null | undefined

  const thumbnailUrl = resolveImageUrl(pickThumbnailUrl(videoRef?.images))

  const displayTitle = title ?? videoRef?.title ?? "Untitled"
  const imageAlt = videoRef?.imageAlt ?? displayTitle

  const handlePress = () => {
    if (sectionKey) {
      router.push(`/video/${encodeURIComponent(sectionKey)}`)
    }
  }

  return (
    <Pressable
      testID={`video-card-${index}`}
      style={({ pressed }) => [
        styles.container,
        pressed && Platform.OS === "ios" && feedback.pressed,
      ]}
      android_ripple={{ color: "rgba(255, 255, 255, 0.2)", foreground: true }}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${displayTitle}`}
    >
      <View style={[card.surface, styles.localCard]}>
        {thumbnailUrl != null ? (
          <Image
            source={thumbnailUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`vcard-${section.id as string}`}
            accessibilityLabel={imageAlt}
            priority="normal"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}

        {/* Bottom gradient */}
        <LinearGradient
          colors={[hexToRgba(BLACK, 0), hexToRgba(BLACK, 0.85)]}
          locations={[0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Text overlay */}
        <View style={styles.textOverlay}>
          <Text style={[text.sectionHeading, typography.titleLarge]}>
            {displayTitle}
          </Text>
          {subtitle != null && (
            <Text
              style={[
                text.sectionSubtitle,
                styles.localSubtitle,
                typography.bodySmall,
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          )}
        </View>

        {/* Play icon — rendered last so it sits above text in z-layer */}
        <View style={overlay.playOverlay} pointerEvents="none">
          <View style={styles.playCircle}>
            <Ionicons
              name="play"
              size={22}
              color={TEXT_ON_OVERLAY}
              style={{ marginLeft: 4 }}
            />
          </View>
        </View>
      </View>
    </Pressable>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 10,
  },
  localCard: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  placeholder: {
    backgroundColor: SURFACE_COLOR,
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  textOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  localSubtitle: {
    marginTop: 2,
  },
})
