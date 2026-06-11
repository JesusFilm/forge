// Video-details screen — /watch/[slug].
//
// Paints from an (untrusted, sanitized) seed for instant first paint, then
// fills in from GET_VIDEO_BY_SLUG (cache-first + returnPartialData so re-entry
// reads the warm cache without a blocking refetch — R3, R21). The normalized
// video is published into the shared WatchSession so the action row's pickers
// (and the in-player menu) read one source of truth.
//
// Layout (Claude Design handoff, "match the mockup exactly"): a full-screen
// cinematic VideoBackdrop with the hero content anchored bottom-left over it —
// a SERIES badge + meta kicker, large title, 2-line teaser, and a single
// left-aligned action row (DetailsActionRow: Play + Language/Subtitles/Share/
// Download pills). Below the fold (opaque #08080a): the Up Next rail, an About
// block, then Related Questions and Bible Quotes.
//
// DEGRADED (R14–R17): a section with zero items is omitted entirely. Below-fold
// sections render only once the full query has resolved (the seed paints
// title/poster first; no per-section spinners).

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/videoQueries"
import { normalizeVideo } from "../../src/lib/normalizeVideo"
import { decodeWatchSeed } from "../../src/lib/watchSeed"
import { muxHlsUrlFromPlaybackId } from "../../src/lib/muxUrl"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useVideoPlayerContext } from "../../src/contexts/VideoPlayerContext"
import { TVFocusGuideView } from "../../src/components/TVFocusGuideView"
import { VideoBackdrop } from "../../src/components/watch/VideoBackdrop"
import { DetailsActionRow } from "../../src/components/watch/DetailsActionRow"
import { UpNextRail } from "../../src/components/watch/UpNextRail"
import { LanguagePanel } from "../../src/components/watch/LanguagePanel"
import { SubtitlePanel } from "../../src/components/watch/SubtitlePanel"
import {
  buildBibleQuotesBlock,
  buildRelatedQuestionsBlock,
} from "../../src/components/watch/detailsAdapters"
import { buildMetadataLine } from "../../src/components/watch/detailsHelpers"
import { WATCH_THEME } from "../../src/components/watch/watchDetailTheme"
import { SECTION_HEADING } from "../../src/components/sections/sectionHeading"
import { RelatedQuestionsRenderer } from "../../src/components/sections/RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "../../src/components/sections/BibleQuotesCarouselRenderer"
import { useBibleVerses } from "../../src/hooks/useBibleVerses"
import { COLORS } from "../../src/lib/colors"
import type { WatchBibleCitation } from "../../src/lib/normalizeVideo"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { scale } from "../../src/lib/scale"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")

// Stable fallback for useBibleVerses while no video is resolved — a fresh []
// each render would re-fire the hook's citations-keyed effect.
const NO_CITATIONS: readonly WatchBibleCitation[] = []

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
  // Stable identity: this lands in the panels' renderRow useCallback deps —
  // an inline arrow would rebuild renderRow (re-rendering all mounted FlatList
  // rows) on every screen render while a sheet is open.
  const closePanel = useCallback(() => setActivePanel("none"), [])

  const hasVideo = video != null

  // Error state: only when the query errored AND there's nothing usable to keep
  // showing — no normalized/cached video and no seed to paint a skeleton from.
  const showErrorState = error != null && !hasVideo && seed == null

  // First paint prefers resolved data, falling back to the seed.
  const displayTitle = video?.title ?? seed?.title ?? null
  // CMS posterUrl is untrusted — sanitize before it reaches expo-image (the
  // seed.imageUrl branch is already resolveImageUrl-sanitized in decodeWatchSeed).
  const displayPoster =
    (video?.posterUrl != null ? resolveImageUrl(video.posterUrl) : null) ??
    seed?.imageUrl ??
    null
  // Backdrop source: active dub → first-playable → seed-derived Mux URL.
  const backdropSource =
    activeVariant?.hls ?? video?.streamingUrl ?? seedStreamingUrl

  // Hero kicker: the label becomes the badge chip (e.g. "SERIES"); the meta line
  // carries duration + language count (label omitted — it's now the badge).
  const badgeLabel = video?.label ?? null
  const heroMeta = buildMetadataLine(
    null,
    activeVariant?.duration ?? video?.duration,
    video?.variants.length ?? null,
  )
  const descriptionText = video?.description ?? null

  // Below-fold section blocks — built from the resolved video only (adapters
  // return null for empty input so the whole section is omitted: R14–R17).
  // Verse text is fetched per citation (useBibleVerses) and threaded into the
  // quote cards; until it resolves the cards render reference-only.
  const bibleVerses = useBibleVerses(video?.bibleCitations ?? NO_CITATIONS)
  const relatedQuestionsBlock = hasVideo
    ? buildRelatedQuestionsBlock(video.studyQuestions)
    : null
  const bibleQuotesBlock = hasVideo
    ? buildBibleQuotesBlock(video.bibleCitations, bibleVerses)
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
        {/* Hero: full-screen cinematic backdrop with content anchored bottom-left. */}
        <View style={styles.hero}>
          <VideoBackdrop
            streamingUrl={backdropSource ?? null}
            posterUrl={displayPoster}
            overlayVisible={playerState.isVisible}
          />

          <View style={styles.heroContent}>
            {badgeLabel != null || heroMeta != null ? (
              <View style={styles.kicker}>
                {badgeLabel != null ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badgeLabel}</Text>
                  </View>
                ) : null}
                {heroMeta != null ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {heroMeta}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {displayTitle != null ? (
              <Text style={styles.title} numberOfLines={2}>
                {displayTitle}
              </Text>
            ) : null}

            {descriptionText != null ? (
              <Text style={styles.teaser} numberOfLines={2}>
                {descriptionText}
              </Text>
            ) : null}

            <DetailsActionRow
              title={displayTitle}
              onOpenLanguage={() => setActivePanel("language")}
              onOpenSubtitles={() => setActivePanel("subtitle")}
            />
          </View>
        </View>

        {/* Below the fold — opaque so it covers the backdrop as the user scrolls. */}
        <View style={styles.below}>
          {hasVideo ? <UpNextRail siblings={video.siblings} /> : null}

          {/* About + Related Questions share one two-column row; either column
              alone stretches across the full row width. The TVFocusGuideView
              spans the full row so vertical D-pad traversal over the
              non-focusable About column redirects into the question rows
              (offset focusables are otherwise skipped by the focus engine). */}
          {descriptionText != null || relatedQuestionsBlock != null ? (
            <TVFocusGuideView autoFocus style={styles.aboutRow}>
              {descriptionText != null ? (
                <View style={styles.aboutCol}>
                  <Text style={styles.aboutHeading} accessibilityRole="header">
                    About
                  </Text>
                  <Text style={styles.aboutText}>{descriptionText}</Text>
                </View>
              ) : null}

              {relatedQuestionsBlock != null ? (
                <View style={styles.questionsCol}>
                  <RelatedQuestionsRenderer
                    section={relatedQuestionsBlock}
                    inset={0}
                  />
                </View>
              ) : null}
            </TVFocusGuideView>
          ) : null}

          {bibleQuotesBlock != null ? (
            <BibleQuotesCarouselRenderer section={bibleQuotesBlock} />
          ) : null}
        </View>
      </ScrollView>

      <LanguagePanel
        visible={activePanel === "language"}
        onClose={closePanel}
      />
      <SubtitlePanel
        visible={activePanel === "subtitle"}
        onClose={closePanel}
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
    backgroundColor: WATCH_THEME.below,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: scale(120),
  },

  // ── Hero ──────────────────────────────────────────────────────────
  hero: {
    height: SCREEN_HEIGHT,
    justifyContent: "flex-end",
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  heroContent: {
    alignItems: "flex-start",
    paddingHorizontal: scale(80),
    paddingBottom: scale(96),
  },
  kicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(14),
    marginBottom: scale(14),
  },
  badge: {
    backgroundColor: WATCH_THEME.badgeBg,
    paddingHorizontal: scale(12),
    paddingVertical: scale(5),
    borderRadius: scale(7),
  },
  badgeText: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "700",
    letterSpacing: scale(2.9),
    color: WATCH_THEME.text,
    textTransform: "uppercase",
  },
  meta: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "500",
    color: WATCH_THEME.text82,
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(78)),
    fontWeight: "800",
    lineHeight: Math.round(scale(80)),
    letterSpacing: -scale(1.5),
    color: WATCH_THEME.text,
    maxWidth: scale(1100),
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: scale(4) },
    textShadowRadius: scale(30),
  },
  teaser: {
    marginTop: scale(22),
    maxWidth: scale(980),
    fontFamily: "System",
    fontSize: Math.round(scale(25)),
    lineHeight: Math.round(scale(36)),
    fontWeight: "400",
    color: WATCH_THEME.text74,
  },

  // ── Below the fold ────────────────────────────────────────────────
  below: {
    backgroundColor: WATCH_THEME.below,
    paddingTop: scale(48),
  },
  aboutRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: scale(64),
    paddingHorizontal: scale(80),
    paddingTop: scale(30),
    paddingBottom: scale(40),
  },
  aboutCol: {
    flex: 1,
  },
  questionsCol: {
    flex: 1,
  },
  aboutHeading: {
    ...SECTION_HEADING,
    marginBottom: scale(18),
  },
  aboutText: {
    fontFamily: "System",
    fontSize: Math.round(scale(23)),
    lineHeight: Math.round(scale(34)),
    color: WATCH_THEME.text66,
  },

  // ── Error state ───────────────────────────────────────────────────
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
