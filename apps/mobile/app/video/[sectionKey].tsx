import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  AppState,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useLocalSearchParams, useNavigation } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useEvent } from "expo"
import { Image } from "expo-image"
import { useVideoPlayer, VideoView } from "expo-video"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useSectionByKey } from "../../src/contexts/ExperienceProvider"
import { ContentDispatcher } from "../../src/components/sections/ContentDispatcher"
import {
  ACCENT,
  BLACK,
  SURFACE_COLOR,
  TEXT_BODY,
  TEXT_ON_OVERLAY,
} from "../../src/lib/color"
import { layout, text, overlay, button } from "../../src/styles/shared"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { validateStreamingUrl } from "../../src/lib/validateUrl"
import { useTypography } from "../../src/hooks/useTypography"
import type { NormalizedBlock } from "../../src/lib/normalizer"
import { pickThumbnailUrl } from "../../src/lib/types"
import type { VideoRef } from "../../src/lib/types"
import { parseSectionKey } from "../../src/lib/parseSectionKey"

// ── Component ───────────────────────────────────────────────────────────────

export default function VideoDetailScreen() {
  const { sectionKey } = useLocalSearchParams<{ sectionKey: string }>()
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  const decodedKey = parseSectionKey(sectionKey)

  const section = useSectionByKey(decodedKey ?? "")

  if (decodedKey == null || section == null) {
    return (
      <View style={[layout.centered, { paddingTop: insets.top + 44 }]}>
        <Text style={text.errorTitle}>Video not found</Text>
        <Text style={text.errorMessage}>
          {decodedKey == null
            ? "Invalid video identifier."
            : `No section found for "${decodedKey}".`}
        </Text>
      </View>
    )
  }

  return <VideoDetailContent section={section} typography={typography} />
}

// ── VideoDetailContent ──────────────────────────────────────────────────────

function VideoDetailContent({
  section,
  typography,
}: {
  section: NormalizedBlock
  typography: ReturnType<typeof useTypography>
}) {
  const streamingUrl = section.streamingUrl as string | null
  const hasValidStream = validateStreamingUrl(streamingUrl)

  const videoRef = section.videoRef as VideoRef | null | undefined

  const title =
    (section.videoTitle as string | null) ??
    videoRef?.title ??
    (section.title as string | null)
  const thumbnailUrl = resolveImageUrl(pickThumbnailUrl(videoRef?.images))

  // Set up share button in the navigation header with actual video context
  const navigation = useNavigation()
  const slug = videoRef?.slug
  useLayoutEffect(() => {
    const displayTitle = title ?? "this video"
    const shareUrl =
      slug != null ? `https://www.jesusfilm.org/watch/${slug}.html` : null
    navigation.setOptions({
      headerTitle: title ?? "",
      headerRight: () => (
        <Pressable
          testID="share-button"
          onPress={() => {
            const parts = [`Check out "${displayTitle}" on JesusFilm!`]
            if (shareUrl != null) parts.push(shareUrl)
            Share.share({ message: parts.join("\n") })
          }}
          accessibilityRole="button"
          accessibilityLabel="Share"
          style={[button.iconButton44, styles.shareExtra]}
        >
          <Ionicons name="share-outline" size={22} color={ACCENT} />
        </Pressable>
      ),
    })
  }, [navigation, title, slug])

  // Sibling content from parent sectionWrapper (attached during indexing)
  const siblings =
    (section.siblingContent as NormalizedBlock[] | undefined) ?? []
  // Filter out the current video — keep other siblings (including other videos)
  const currentKey = section.sectionKey as string | undefined
  const nestedContent = siblings.filter(
    (c) =>
      (c.sectionKey as string | undefined) !== currentKey &&
      c.kind !== "navigationCarousel",
  )

  const rawParagraphs = section.contentParagraphs
  const contentParagraphs = Array.isArray(rawParagraphs)
    ? rawParagraphs.filter((p): p is string => typeof p === "string")
    : []
  const description =
    contentParagraphs.length > 0 ? contentParagraphs.join(" ") : null

  const [hasStarted, setHasStarted] = useState(false)
  const [showFullDescription, setShowFullDescription] = useState(false)
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
      style={layout.screenContainer}
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
                testID="video-thumbnail"
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
                <View style={overlay.playOverlay}>
                  <View style={styles.playCircle}>
                    <Ionicons
                      name="play"
                      size={28}
                      color={TEXT_ON_OVERLAY}
                      style={{ marginLeft: 4 }}
                    />
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

      {/* Description below the player */}
      {description != null && description.length > 0 && (
        <View style={styles.descriptionArea}>
          <Text
            style={[styles.descriptionText, typography.body]}
            numberOfLines={showFullDescription ? undefined : 3}
          >
            {description}
          </Text>
          {description.length > 120 && (
            <Pressable
              onPress={() => setShowFullDescription((prev) => !prev)}
              accessibilityRole="button"
              accessibilityLabel={
                showFullDescription ? "Show less" : "Read more"
              }
            >
              <Text style={[text.accentLinkText, styles.readMoreExtra]}>
                {showFullDescription ? "Show less" : "Read more"}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Nested content */}
      {nestedContent.length > 0 && (
        <ContentDispatcher content={nestedContent} />
      )}
    </ScrollView>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  playerContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: BLACK,
  },
  fallback: {
    backgroundColor: SURFACE_COLOR,
  },
  // Accent-colored play button per iOS Video Detail (HIG) mockup.
  // Home feed cards use dark play buttons (VideoCardRenderer).
  // Fully opaque for reliable 3:1+ contrast against arbitrary thumbnails.
  playCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: ACCENT,
    justifyContent: "center",
    alignItems: "center",
  },
  descriptionArea: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  descriptionText: {
    color: TEXT_BODY,
    fontFamily: "System",
    lineHeight: 22,
  },
  readMoreButton: {
    minHeight: 48,
    justifyContent: "center",
  },
  readMoreExtra: {
    marginTop: 4,
    fontSize: 15,
  },
  shareExtra: {},
})
