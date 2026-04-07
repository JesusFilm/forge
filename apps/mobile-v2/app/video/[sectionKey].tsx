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
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { validateStreamingUrl } from "../../src/lib/validateUrl"
import { useTypography } from "../../src/hooks/useTypography"
import type { NormalizedBlock } from "../../src/lib/normalizer"

// ── Constants ───────────────────────────────────────────────────────────────

/** Only allow safe sectionKey values (alphanumeric, hyphens, underscores, slashes, percent-encoded). */
const SECTION_KEY_PATTERN = /^[a-zA-Z0-9_/%-]+$/

// ── Component ───────────────────────────────────────────────────────────────

export default function VideoDetailScreen() {
  const { sectionKey } = useLocalSearchParams<{ sectionKey: string }>()
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  // Decode and validate sectionKey (decodeURIComponent can throw on malformed input)
  let decodedKey: string | null = null
  if (sectionKey != null) {
    try {
      decodedKey = decodeURIComponent(sectionKey)
    } catch {
      // Malformed percent-encoding (e.g. "%ZZ") — treat as invalid
    }
  }
  const isValidKey = decodedKey != null && SECTION_KEY_PATTERN.test(decodedKey)

  const section = useSectionByKey(
    isValidKey && decodedKey != null ? decodedKey : "",
  )

  if (!isValidKey || section == null) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + 44 }]}>
        <Text style={styles.errorTitle}>Video not found</Text>
        <Text style={styles.errorMessage}>
          {!isValidKey
            ? "Invalid video identifier."
            : `No section found for "${decodedKey}".`}
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

  // Set up share button in the navigation header with actual video context
  const navigation = useNavigation()
  useLayoutEffect(() => {
    const displayTitle = title ?? "this video"
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            Share.share({
              message: `Check out "${displayTitle}" on JesusFilm!`,
            })
          }}
          accessibilityRole="button"
          accessibilityLabel="Share"
          style={styles.shareButton}
        >
          <Ionicons name="share-outline" size={22} color="#CB333B" />
        </Pressable>
      ),
    })
  }, [navigation, title])

  // Sibling content from parent sectionWrapper (attached during indexing)
  const siblings =
    (section.siblingContent as NormalizedBlock[] | undefined) ?? []
  // Filter out the current video — keep other siblings (including other videos)
  const currentKey = section.sectionKey as string | undefined
  const nestedContent = siblings.filter(
    (c) => (c.sectionKey as string | undefined) !== currentKey,
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
                <Text style={styles.readMoreText}>
                  {showFullDescription ? "Show less" : "Read more"}
                </Text>
              </Pressable>
            )}
          </View>
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
  // Accent-colored play button per iOS Video Detail (HIG) mockup.
  // Home feed cards use dark play buttons (VideoCardRenderer).
  playCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(203, 51, 59, 0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    fontSize: 28,
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
  descriptionArea: {
    marginTop: 12,
  },
  descriptionText: {
    color: "#d6d3d1",
    fontFamily: "System",
    lineHeight: 22,
  },
  readMoreText: {
    color: "#CB333B",
    fontWeight: "600",
    fontFamily: "System",
    marginTop: 4,
    fontSize: 15,
  },
  shareButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
})
