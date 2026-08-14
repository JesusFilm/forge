import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useLocalSearchParams, useNavigation } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Image } from "expo-image"
import { VideoView } from "expo-video"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useManagedVideoPlayer } from "../../src/hooks/useManagedVideoPlayer"
import { useEndMiniPlayerOnPlayback } from "../../src/hooks/useEndMiniPlayerOnPlayback"
import { pictureInPictureViewProps } from "../../src/lib/miniPlayer/pictureInPicture"

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
import type { AdminBlock } from "../../src/lib/queries"
import { deriveMuxThumbnailUrl } from "../../src/lib/muxThumbnail"
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
  section: AdminBlock
  typography: ReturnType<typeof useTypography>
}) {
  const s = section as Record<string, unknown>
  const streamingUrl = s.streamingUrl as string | null
  const blockVideoId =
    typeof s.videoId === "string" && s.videoId.length > 0
      ? s.videoId
      : undefined
  const hasValidStream = validateStreamingUrl(streamingUrl)

  const title = (s.title as string | null) ?? "Untitled"
  const thumbnailUrl = resolveImageUrl(deriveMuxThumbnailUrl(streamingUrl))

  const navigation = useNavigation()
  useLayoutEffect(() => {
    const displayTitle = title ?? "this video"
    navigation.setOptions({
      headerTitle: title ?? "",
      headerRight: () => (
        <Pressable
          onPress={() => {
            Share.share({
              message: `Check out "${displayTitle}" on JesusFilm!`,
            })
          }}
          accessibilityRole="button"
          accessibilityLabel="Share"
          style={[button.iconButton44, styles.shareExtra]}
        >
          <Ionicons name="share-outline" size={22} color={ACCENT} />
        </Pressable>
      ),
    })
  }, [navigation, title])

  const siblings = (s.siblingContent as AdminBlock[] | undefined) ?? []
  const currentKey = s.sectionKey as string | undefined
  const nestedContent = siblings.filter(
    (c) =>
      ("sectionKey" in c ? (c.sectionKey as string | undefined) : undefined) !==
        currentKey && c.__typename !== "NavigationCarouselBlock",
  )

  const rawParagraphs = s.contentParagraphs
  const contentParagraphs = Array.isArray(rawParagraphs)
    ? rawParagraphs.filter((p): p is string => typeof p === "string")
    : []
  const description =
    contentParagraphs.length > 0 ? contentParagraphs.join(" ") : null

  const [hasStarted, setHasStarted] = useState(false)
  const [showFullDescription, setShowFullDescription] = useState(false)

  // Shared lifecycle adapter (todo 016). Deliberate convergence: foreground now
  // resumes only if playback was active at background — the old inline handler
  // called play() unconditionally, starting videos the user paused/never played.
  const { player, isPlaying } = useManagedVideoPlayer(
    hasValidStream ? streamingUrl : null,
    undefined,
    // KTD5 opt-in: this SDUI block carries the admin video id.
    { progress: blockVideoId ? { videoId: blockVideoId } : null },
  )

  // R9/R10: this route owns its own decoder, so the floating window and this
  // video cannot both play. The viewer's newest choice wins.
  useEndMiniPlayerOnPlayback(isPlaying)

  useEffect(() => {
    if (isPlaying && !hasStarted) {
      setHasStarted(true)
    }
  }, [isPlaying, hasStarted])

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
              fullscreenOptions={{ enable: true }}
              // R14/R15: native controls put the platform's own
              // picture-in-picture button here, so this surface must behave
              // like the watch player and feed the same latch.
              {...pictureInPictureViewProps()}
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
                  accessibilityLabel={title ?? "Video thumbnail"}
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
            accessibilityLabel={title ?? "Video thumbnail"}
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
