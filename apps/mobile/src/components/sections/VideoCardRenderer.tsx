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
import type { AdminBlock } from "../../lib/queries"
import { deriveMuxThumbnailUrl } from "../../lib/muxThumbnail"
import { useVideoThumbnail } from "../../contexts/ExperienceProvider"

// ── Types ───────────────────────────────────────────────────────────────────

export interface VideoCardRendererProps {
  section: AdminBlock
}

// ── Component ───────────────────────────────────────────────────────────────

export function VideoCardRenderer({ section }: VideoCardRendererProps) {
  const router = useRouter()
  const typography = useTypography()

  const s = section as Record<string, unknown>
  const title = (s.title as string | null) ?? "Untitled"
  const subtitle = s.subtitle as string | null
  const sectionKey = s.sectionKey as string | null
  const streamingUrl = s.streamingUrl as string | null
  const videoId = s.videoId as string | null

  const resolvedThumb = useVideoThumbnail(videoId)
  const thumbnailUrl = resolveImageUrl(
    resolvedThumb ?? deriveMuxThumbnailUrl(streamingUrl),
  )

  const handlePress = () => {
    if (sectionKey) {
      router.push(`/video/${encodeURIComponent(sectionKey)}`)
    }
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        pressed && Platform.OS === "ios" && feedback.pressed,
      ]}
      android_ripple={{ color: "rgba(255, 255, 255, 0.2)", foreground: true }}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${title}`}
    >
      <View style={[card.surface, styles.localCard]}>
        {thumbnailUrl != null ? (
          <Image
            source={thumbnailUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`vcard-${sectionKey ?? "x"}`}
            accessibilityLabel={title}
            priority="normal"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}

        <LinearGradient
          colors={[hexToRgba(BLACK, 0), hexToRgba(BLACK, 0.85)]}
          locations={[0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={styles.textOverlay}>
          <Text style={[text.sectionHeading, typography.titleLarge]}>
            {title}
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
