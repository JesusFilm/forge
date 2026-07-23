import { StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"

import { SURFACE_COLOR } from "../../lib/color"
import { resolveThumbnailUrl } from "../../lib/resolveThumbnailUrl"
import { useTypography } from "../../hooks/useTypography"
import { card, text } from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"
import { useVideoThumbnail } from "../../contexts/ExperienceProvider"
import { PressableCard } from "../ui/PressableCard"
import { blockStreamingUrl } from "../../lib/blockVideoDub"

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
  const streamingUrl = blockStreamingUrl(s)
  const videoId = s.videoId as string | null

  const resolvedThumb = useVideoThumbnail(videoId)
  const thumbnailUrl = resolveThumbnailUrl(resolvedThumb, streamingUrl)

  const handlePress = () => {
    if (sectionKey) {
      router.push(`/video/${encodeURIComponent(sectionKey)}`)
    }
  }

  return (
    <PressableCard
      onPress={handlePress}
      accessibilityLabel={`Play ${title}`}
      style={styles.container}
      surfaceStyle={[card.surface, styles.localCard]}
      background={
        thumbnailUrl != null ? (
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
        )
      }
      scrim="standard"
      playOverlay="large"
    >
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
    </PressableCard>
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
