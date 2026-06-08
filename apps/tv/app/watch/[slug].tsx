// Video-details screen — /watch/[slug].
//
// Paints from an (untrusted, sanitized) seed for instant first paint, then
// fills in from GET_VIDEO_BY_SLUG (cache-first + returnPartialData so re-entry
// reads the warm cache without a blocking refetch — R3, R21). The normalized
// video is published into the shared WatchSession so the action row's pickers
// (and, later, the in-player menu) read one source of truth.
//
// Composition (top → bottom): non-interactive VideoBackdrop, title + metadata,
// description (TextRenderer via adapter), DetailsActionRow (owns the Language /
// Subtitle panels), Up Next rail, Related Questions (adapter), Bible Quotes
// (adapter).
//
// DEGRADED (R14–R17): a section with zero items is omitted entirely (heading +
// body) — the adapters return null and the rail renders nothing. Below-fold
// sections render only once the full query has resolved (the seed paints
// title/poster first; no per-section spinners).

import { useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/videoQueries"
import { normalizeVideo } from "../../src/lib/normalizeVideo"
import { decodeWatchSeed } from "../../src/lib/watchSeed"
import { muxHlsUrlFromPlaybackId } from "../../src/lib/muxUrl"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useVideoPlayerContext } from "../../src/contexts/VideoPlayerContext"
import { VideoBackdrop } from "../../src/components/watch/VideoBackdrop"
import { DetailsActionRow } from "../../src/components/watch/DetailsActionRow"
import { UpNextRail } from "../../src/components/watch/UpNextRail"
import { LanguagePanel } from "../../src/components/watch/LanguagePanel"
import { SubtitlePanel } from "../../src/components/watch/SubtitlePanel"
import {
  buildBibleQuotesBlock,
  buildDescriptionBlock,
  buildRelatedQuestionsBlock,
} from "../../src/components/watch/detailsAdapters"
import { buildMetadataLine } from "../../src/components/watch/detailsHelpers"
import { TextRenderer } from "../../src/components/sections/TextRenderer"
import { RelatedQuestionsRenderer } from "../../src/components/sections/RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "../../src/components/sections/BibleQuotesCarouselRenderer"
import { COLORS } from "../../src/lib/colors"
import { scale } from "../../src/lib/scale"

type ActivePanel = "none" | "language" | "subtitle"

export default function WatchVideoScreen() {
  const { slug, seed: seedParam } = useLocalSearchParams<{
    slug: string
    seed?: string
  }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""

  const { video, setVideo, activeVariant } = useWatchSession()
  const { state: playerState } = useVideoPlayerContext()

  const { data, error, refetch } = useQuery(GET_VIDEO_BY_SLUG, {
    variables: { locale: "en", slug: decodedSlug },
    skip: !decodedSlug,
    // cache-first (NOT cache-and-network): the payload is large for videos with
    // many dubs; cache-and-network would refetch + re-normalize every dub on
    // re-entry. returnPartialData paints whatever the cache already holds.
    fetchPolicy: "cache-first",
    returnPartialData: true,
  })

  // Keyed on the inner videoBySlug object (NOT the outer `data` wrapper): a new
  // wrapper over an unchanged inner object — common on partial → full transitions
  // — must not re-walk normalizeVideo over thousands of dubs.
  const normalized = useMemo(
    () =>
      normalizeVideo(
        (data?.videoBySlug ?? null) as Parameters<typeof normalizeVideo>[0],
      ),
    [data?.videoBySlug],
  )

  // Seed: instant first paint (title + poster) from data carried by the list
  // surface. Sanitized — a crafted deep link can't reach the player/image loader.
  const seed = useMemo(() => decodeWatchSeed(seedParam), [seedParam])
  const seedStreamingUrl = useMemo(
    () => muxHlsUrlFromPlaybackId(seed?.playbackId ?? null),
    [seed],
  )

  // Publish the fetched video into the shared session; keyed on the normalized
  // object so partial → full enrichment republishes (the session guards user
  // selections across these republishes).
  useEffect(() => {
    if (normalized) setVideo(normalized)
  }, [normalized, setVideo])

  // Navigated to a different video that hasn't loaded yet (e.g. Up Next): drop
  // the previous video from the session so its stale variants don't leak.
  useEffect(() => {
    if (video && video.slug !== decodedSlug && !normalized) {
      setVideo(null)
    }
  }, [decodedSlug, video, normalized, setVideo])

  // Clear the session on unmount so a stale dub selection can't attach to a
  // later experience-card play (the overlay gates on a matching session in U7).
  useEffect(() => {
    return () => setVideo(null)
  }, [setVideo])

  const [activePanel, setActivePanel] = useState<ActivePanel>("none")

  const hasVideo = video != null

  // Error state: only when the query errored AND there's nothing usable to keep
  // showing — no normalized/cached video and no seed to paint a skeleton from.
  // If a seed or cached video exists we prefer that (degraded-but-usable) over a
  // hard error screen, so the seed-skeleton behavior survives a transient error.
  const showErrorState = error != null && !hasVideo && seed == null

  // First paint prefers resolved data, falling back to the seed.
  const displayTitle = video?.title ?? seed?.title ?? null
  const displayPoster = video?.posterUrl ?? seed?.imageUrl ?? null
  // Backdrop source: active dub → first-playable → seed-derived Mux URL.
  const backdropSource =
    activeVariant?.hls ?? video?.streamingUrl ?? seedStreamingUrl

  const metadataLine = buildMetadataLine(
    video?.label,
    activeVariant?.duration ?? video?.duration,
    video?.variants.length ?? null,
  )

  // Below-fold section blocks — built from the resolved video only (adapters
  // return null for empty input so the whole section is omitted: R14–R17).
  const descriptionBlock = hasVideo
    ? buildDescriptionBlock(video.description)
    : null
  const relatedQuestionsBlock = hasVideo
    ? buildRelatedQuestionsBlock(video.studyQuestions)
    : null
  const bibleQuotesBlock = hasVideo
    ? buildBibleQuotesBlock(video.bibleCitations)
    : null

  if (showErrorState) {
    return (
      <View style={[styles.screen, styles.errorCentered]}>
        <Text style={styles.errorMessage}>
          This video is temporarily unavailable.
        </Text>
        <RetryButton
          onPress={() => {
            void refetch()
          }}
        />
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <VideoBackdrop
          streamingUrl={backdropSource ?? null}
          posterUrl={displayPoster}
          overlayVisible={playerState.isVisible}
        />

        <View style={styles.titleBlock}>
          {displayTitle != null ? (
            <Text style={styles.title} numberOfLines={2}>
              {displayTitle}
            </Text>
          ) : null}
          {metadataLine != null ? (
            <Text style={styles.metadata} numberOfLines={1}>
              {metadataLine}
            </Text>
          ) : null}
        </View>

        <DetailsActionRow
          title={displayTitle}
          onOpenLanguage={() => setActivePanel("language")}
          onOpenSubtitles={() => setActivePanel("subtitle")}
        />

        {descriptionBlock != null ? (
          <TextRenderer section={descriptionBlock} />
        ) : null}

        {hasVideo ? <UpNextRail siblings={video.siblings} /> : null}

        {relatedQuestionsBlock != null ? (
          <RelatedQuestionsRenderer section={relatedQuestionsBlock} />
        ) : null}

        {bibleQuotesBlock != null ? (
          <BibleQuotesCarouselRenderer section={bibleQuotesBlock} />
        ) : null}
      </ScrollView>

      <LanguagePanel
        visible={activePanel === "language"}
        onClose={() => setActivePanel("none")}
      />
      <SubtitlePanel
        visible={activePanel === "subtitle"}
        onClose={() => setActivePanel("none")}
      />
    </View>
  )
}

/**
 * Focusable "Try again" control for the error state. Uses the
 * onFocus / onBlur + state pattern (matching SearchResultsGrid's
 * RetryButton) rather than the `({ focused }) => [...]` callback —
 * `focused` is exposed at runtime by react-native-tvos but not by the
 * upstream PressableStateCallbackType, so the callback form fails the
 * strict tsc check.
 */
function RetryButton({ onPress }: { onPress: () => void }) {
  const [isFocused, setIsFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Try again"
      accessibilityHint="Reloads this video"
      hasTVPreferredFocus
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={[styles.retryButton, isFocused && styles.retryButtonFocused]}
      onPress={onPress}
    >
      <Text style={styles.retryText}>Try again</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: scale(120),
  },
  titleBlock: {
    paddingHorizontal: scale(80),
    paddingTop: scale(8),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(48)),
    fontWeight: "bold",
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  metadata: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    color: COLORS.muted,
    marginTop: scale(8),
  },
  errorCentered: {
    alignItems: "center",
    justifyContent: "center",
    gap: scale(20),
    paddingHorizontal: scale(80),
  },
  errorMessage: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: scale(32),
    paddingVertical: scale(14),
    borderRadius: scale(24),
    backgroundColor: COLORS.primary,
  },
  retryButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: COLORS.primary,
    shadowRadius: scale(20),
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
  retryText: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "600",
    color: COLORS.text,
  },
})
