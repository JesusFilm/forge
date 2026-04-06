import { useCallback, useEffect, useRef, useState } from "react"
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useEvent } from "expo"
import { Image } from "expo-image"
import { useVideoPlayer, VideoView } from "expo-video"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useSectionByKey } from "../../src/contexts/ExperienceProvider"
import { ContentDispatcher } from "../../src/components/sections/ContentDispatcher"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { validateStreamingUrl } from "../../src/lib/validateUrl"
import { useTypography } from "../../src/hooks/useTypography"
import type { NormalizedBlock } from "../../src/lib/normalizer"

// ── Constants ───────────────────────────────────────────────────────────────

/** Only allow safe sectionKey values (alphanumeric, hyphens, underscores). */
const SECTION_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

// ── Component ───────────────────────────────────────────────────────────────

export default function VideoDetailScreen() {
  const { sectionKey } = useLocalSearchParams<{ sectionKey: string }>()
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  // Validate sectionKey format
  const isValidKey = sectionKey != null && SECTION_KEY_PATTERN.test(sectionKey)

  const section = useSectionByKey(isValidKey ? sectionKey : "")

  if (!isValidKey || section == null) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + 44 }]}>
        <Text style={styles.errorTitle}>Video not found</Text>
        <Text style={styles.errorMessage}>
          {!isValidKey
            ? "Invalid video identifier."
            : `No section found for "${sectionKey}".`}
        </Text>
      </View>
    )
  }

  return (
    <VideoDetailContent
      section={section}
      insetTop={insets.top}
      typography={typography}
    />
  )
}

// ── VideoDetailContent ──────────────────────────────────────────────────────

function VideoDetailContent({
  section,
  insetTop: _insetTop,
  typography,
}: {
  section: NormalizedBlock
  insetTop: number
  typography: ReturnType<typeof useTypography>
}) {
  const streamingUrl = section.streamingUrl as string | null
  const hasValidStream = validateStreamingUrl(streamingUrl)

  const videoRef = section.videoRef as
    | {
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

  const title =
    (section.videoTitle as string | null) ??
    videoRef?.title ??
    (section.title as string | null)
  const subtitle =
    (section.videoSubtitle as string | null) ??
    (section.subtitle as string | null)

  const thumbnailUrl = resolveImageUrl(
    videoRef?.images?.mobileCinematicHigh ??
      videoRef?.images?.videoStill ??
      videoRef?.images?.url ??
      null,
  )

  // Nested content from sectionWrapper parent
  const sectionContent =
    (section.sectionContent as NormalizedBlock[] | undefined) ?? []
  // Filter out the video itself from nested content
  const nestedContent = sectionContent.filter((c) => c.kind !== "video")

  const [hasStarted, setHasStarted] = useState(false)
  const appActiveRef = useRef(true)

  const player = useVideoPlayer(hasValidStream ? streamingUrl : null, (p) => {
    p.muted = false
    p.loop = false
  })

  // Defensive cleanup
  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Already released
      }
    }
  }, [player])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  useEffect(() => {
    if (isPlaying && !hasStarted) {
      setHasStarted(true)
    }
  }, [isPlaying, hasStarted])

  // AppState handling
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active"
      if (appActiveRef.current) {
        player.play()
      } else {
        try {
          player.pause()
        } catch {
          // Released
        }
      }
    })
    return () => subscription.remove()
  }, [player])

  const handlePlay = useCallback(() => {
    player.play()
  }, [player])

  return (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={{ paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Video player */}
      <View style={styles.playerContainer}>
        {hasValidStream ? (
          <>
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              nativeControls
              allowsFullscreen
              allowsPictureInPicture
              contentFit="contain"
            />
            {!hasStarted && thumbnailUrl != null && (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={handlePlay}
                accessibilityRole="button"
                accessibilityLabel="Play video"
              >
                <Image
                  source={thumbnailUrl}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  accessibilityLabel={
                    videoRef?.imageAlt ?? title ?? "Video thumbnail"
                  }
                />
                <View style={styles.playOverlay}>
                  <View style={styles.playCircle}>
                    <Text style={styles.playIcon}>{"▶"}</Text>
                  </View>
                </View>
              </Pressable>
            )}
          </>
        ) : thumbnailUrl != null ? (
          <Image
            source={thumbnailUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityLabel={
              videoRef?.imageAlt ?? title ?? "Video thumbnail"
            }
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallback]} />
        )}
      </View>

      {/* Title area */}
      <View style={styles.titleArea}>
        {title != null && (
          <Text
            style={[styles.title, typography.titleLarge]}
            accessibilityRole="header"
          >
            {title}
          </Text>
        )}
        {subtitle != null && (
          <Text style={[styles.subtitle, typography.body]}>{subtitle}</Text>
        )}
      </View>

      {/* Nested content */}
      {nestedContent.length > 0 && (
        <ContentDispatcher content={nestedContent} />
      )}
    </ScrollView>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
    backgroundColor: "#1c1917",
  },
  centered: {
    flex: 1,
    backgroundColor: "#1c1917",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  errorTitle: {
    color: "#f5f5f4",
    fontSize: 22,
    fontWeight: "bold",
    fontFamily: "System",
    marginBottom: 8,
  },
  errorMessage: {
    color: "#a8a29e",
    fontSize: 15,
    fontFamily: "System",
    textAlign: "center",
  },
  playerContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
  },
  fallback: {
    backgroundColor: "#292524",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    fontSize: 24,
    color: "#ffffff",
    marginLeft: 4,
  },
  titleArea: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  title: {
    fontWeight: "700",
    color: "#f5f5f4",
    fontFamily: "System",
    marginBottom: 4,
  },
  subtitle: {
    fontWeight: "400",
    color: "#a8a29e",
    fontFamily: "System",
  },
})
