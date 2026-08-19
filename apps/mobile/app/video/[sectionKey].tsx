import { useLayoutEffect, useState } from "react"
import {
  Platform,
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
import { useAutostartPlayback } from "../../src/hooks/useAutostartPlayback"

import { useSectionByKey } from "../../src/contexts/ExperienceProvider"
import { ContentDispatcher } from "../../src/components/sections/ContentDispatcher"
import { PlayerLoadingVeil } from "../../src/components/watch/PlayerLoadingVeil"
import { ACCENT, BLACK, SURFACE_COLOR, TEXT_BODY } from "../../src/lib/color"
import { layout, text, button } from "../../src/styles/shared"
import { useEndSessionOnViewerInitiatedPlayback } from "../../src/hooks/useEndSessionOnViewerInitiatedPlayback"
import { pictureInPictureViewProps } from "../../src/lib/miniPlayer/pictureInPicture"
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

  // Autostarts behind a poster + spinner, the same as every other player
  // surface. Opening this screen IS the viewer asking to watch, so it must not
  // sit on a play button waiting for a second tap.
  const { awaitingAutostart } = useAutostartPlayback(
    player,
    hasValidStream ? streamingUrl : null,
    isPlaying,
  )

  useEndSessionOnViewerInitiatedPlayback(isPlaying)

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
              // Android SurfaceView composites outside the RN tree and punches
              // through the poster and veil below. No-op on iOS.
              surfaceType={
                Platform.OS === "android" ? "textureView" : undefined
              }
              // Native controls carry a picture-in-picture button on iOS, so
              // this view feeds the same latch the host does. `automatic` is
              // the host's alone — expo-video elects only one view.
              {...pictureInPictureViewProps({ automatic: false })}
              contentFit="contain"
            />
            {/* Poster and veil share ONE predicate. Gating the poster on
                `!hasStarted` instead would leave it covering the native
                controls after a failed or timed-out load — visible controls
                are the recovery affordance, so both must clear together. */}
            {awaitingAutostart && thumbnailUrl != null && (
              <Image
                source={thumbnailUrl}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                pointerEvents="none"
                recyclingKey={`sdui-video-poster-${currentKey ?? title}`}
                accessibilityLabel={title ?? "Video thumbnail"}
              />
            )}
            {awaitingAutostart && <PlayerLoadingVeil />}
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
