import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"

import { hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { useTypography } from "../../hooks/useTypography"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Types ───────────────────────────────────────────────────────────────────

export interface VideoCardRendererProps {
  section: NormalizedBlock
}

// ── Component ───────────────────────────────────────────────────────────────

export function VideoCardRenderer({ section }: VideoCardRendererProps) {
  const router = useRouter()
  const typography = useTypography()

  const title =
    (section.videoTitle as string | null) ?? (section.title as string | null)
  const subtitle =
    (section.videoSubtitle as string | null) ??
    (section.subtitle as string | null)
  const sectionKey =
    (section.sectionKey as string | null) ?? (section.id as string | null)

  const videoRef = section.videoRef as
    | {
        documentId?: string
        title?: string
        slug?: string
        imageAlt?: string
        images?: {
          url?: string
          mobileCinematicHigh?: string
          videoStill?: string
        }
      }
    | null
    | undefined

  const thumbnailUrl = resolveImageUrl(
    videoRef?.images?.mobileCinematicHigh ??
      videoRef?.images?.videoStill ??
      videoRef?.images?.url ??
      null,
  )

  const displayTitle = title ?? videoRef?.title ?? "Untitled"
  const imageAlt = videoRef?.imageAlt ?? displayTitle

  const handlePress = () => {
    if (sectionKey) {
      router.push(`/video/${sectionKey}`)
    }
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
      android_ripple={{ color: "rgba(255, 255, 255, 0.2)", foreground: true }}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${displayTitle}`}
    >
      <View style={styles.card}>
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
          colors={[hexToRgba("#000000", 0), hexToRgba("#000000", 0.85)]}
          locations={[0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Play icon */}
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={styles.playCircle}>
            <Text style={styles.playIcon}>{"▶"}</Text>
          </View>
        </View>

        {/* Text overlay */}
        <View style={styles.textOverlay}>
          <Text style={[styles.title, typography.titleLarge]} numberOfLines={2}>
            {displayTitle}
          </Text>
          {subtitle != null && (
            <Text
              style={[styles.subtitle, typography.bodySmall]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  pressed: {
    opacity: 0.85,
  },
  card: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#292524",
  },
  placeholder: {
    backgroundColor: "#292524",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playCircle: {
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
  textOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  title: {
    fontWeight: "700",
    color: "#f5f5f4",
    fontFamily: "System",
  },
  subtitle: {
    fontWeight: "400",
    color: "#a8a29e",
    fontFamily: "System",
    marginTop: 2,
  },
})
