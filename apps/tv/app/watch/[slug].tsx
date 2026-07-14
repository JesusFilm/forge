// Video-details screen (/watch/[slug]): sanitized seed for instant first paint,
// then GET_VIDEO_BY_SLUG (cache-first + returnPartialData, R3/R21) into the shared
// WatchSession. DEGRADED (R14–R17): empty sections omitted; below-fold last.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Dimensions, ScrollView, StyleSheet, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/videoQueries"
import { normalizeVideo } from "../../src/lib/normalizeVideo"
import { resolveWatchRedirect } from "../../src/lib/watchRedirect"
import { decodeWatchSeed, encodeWatchSeed } from "../../src/lib/watchSeed"
import { muxHlsUrlFromPlaybackId } from "../../src/lib/muxUrl"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useVideoPlayerContext } from "../../src/contexts/VideoPlayerContext"
import { TVFocusGuideView } from "../../src/components/TVFocusGuideView"
import { VideoBackdrop } from "../../src/components/watch/VideoBackdrop"
import { ScreenStateView } from "../../src/components/ScreenStateView"
import { DetailsActionRow } from "../../src/components/watch/DetailsActionRow"
import { UpNextRail } from "../../src/components/watch/UpNextRail"
import { LanguagePanel } from "../../src/components/watch/LanguagePanel"
import { SubtitlePanel } from "../../src/components/watch/SubtitlePanel"
import {
  buildBibleQuotesBlock,
  buildRelatedQuestionsBlock,
} from "../../src/components/watch/detailsAdapters"
import { buildMetadataLine } from "../../src/components/watch/detailsHelpers"
import {
  WATCH_THEME,
  HERO_PEEK,
} from "../../src/components/watch/watchDetailTheme"
import { SECTION_HEADING } from "../../src/components/sections/sectionHeading"
import { RelatedQuestionsRenderer } from "../../src/components/sections/RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "../../src/components/sections/BibleQuotesCarouselRenderer"
import { useBibleVerses } from "../../src/hooks/useBibleVerses"
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
  const router = useRouter()

  const { video, setVideo, activeVariant } = useWatchSession()
  const { state: playerState } = useVideoPlayerContext()

  const { data, error, loading, refetch } = useQuery(GET_VIDEO_BY_SLUG, {
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

  // A series reached via /watch replaces (not pushes) to the series screen so Menu
  // pops to origin. Decides on complete data only, label-only (unlabeled-with-
  // children stays here, mirrors mobile); seed playbackId nulled, once-guarded.
  const redirectDecision = resolveWatchRedirect(normalized, { loading })
  const redirectedRef = useRef<string | null>(null)
  useEffect(() => {
    if (redirectDecision !== "redirect") return
    if (redirectedRef.current === decodedSlug) return
    redirectedRef.current = decodedSlug
    const seriesSeed = seed
      ? encodeWatchSeed({ ...seed, playbackId: null })
      : null
    const target = seriesSeed
      ? `/series/${encodeURIComponent(decodedSlug)}?seed=${seriesSeed}`
      : `/series/${encodeURIComponent(decodedSlug)}`
    router.replace(target)
  }, [redirectDecision, decodedSlug, seed, router])

  // Re-publish into the shared session WHILE FOCUSED so a child screen's pop (its
  // unmount clears the singleton below) doesn't strand this still-mounted parent at
  // video=null, blanking everything session-driven (Up Next/About/RQ/pills).
  useFocusEffect(
    useCallback(() => {
      if (normalized) setVideo(normalized)
    }, [normalized, setVideo]),
  )

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

  // Below-fold blocks from the resolved video only (adapters return null for empty
  // input so the section is omitted, R14–R17). Verse text is fetched per citation
  // (useBibleVerses) into the quote cards; until it resolves cards are ref-only.
  const bibleVerses = useBibleVerses(video?.bibleCitations ?? NO_CITATIONS)
  const relatedQuestionsBlock = hasVideo
    ? buildRelatedQuestionsBlock(video.studyQuestions)
    : null
  const bibleQuotesBlock = hasVideo
    ? buildBibleQuotesBlock(video.bibleCitations, bibleVerses)
    : null

  // Redirect frame: a series record bound for /series renders only the screen
  // background until the replace lands — mounting the VideoBackdrop here would
  // grab a scarce tvOS decode slot it immediately drops.
  if (redirectDecision === "redirect") {
    return <View style={styles.screen} />
  }

  if (showErrorState) {
    return (
      <View style={styles.screen}>
        <ScreenStateView
          kind="error"
          message="This video is temporarily unavailable."
          onRetry={() => {
            void refetch()
          }}
          retryHint="Reloads this video"
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
        {/* Hero: backdrop fills the HERO_PEEK-shortened hero so video clips by
            construction (full-height VideoView punches through Up Next on Android —
            SurfaceView ignores overflow:hidden). bottomFadeColor fades inside it. */}
        <View style={styles.hero}>
          <VideoBackdrop
            streamingUrl={backdropSource ?? null}
            posterUrl={displayPoster}
            overlayVisible={playerState.isVisible}
            bottomFadeColor={WATCH_THEME.below}
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

          {/* About + Related Questions share a two-column row. TVFocusGuideView
              spans the row so vertical D-pad over the non-focusable About column
              redirects into the question rows (offset focusables are else skipped). */}
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
    // Shortened by HERO_PEEK so Up Next peeks above the fold. The VideoBackdrop
    // fills this (not full-screen) so its VideoView clips by construction on both
    // platforms; overflow:hidden still guards the poster/scrim layers.
    height: SCREEN_HEIGHT - HERO_PEEK,
    justifyContent: "flex-end",
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  heroContent: {
    alignItems: "flex-start",
    paddingHorizontal: scale(80),
    // Tightened (was 96) to shrink the dead band between the action row and the
    // Up Next rail below.
    paddingBottom: scale(52),
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
    fontSize: Math.round(scale(27)),
    lineHeight: Math.round(scale(39)),
    fontWeight: "400",
    color: WATCH_THEME.text,
  },

  // ── Below the fold ────────────────────────────────────────────────
  below: {
    backgroundColor: WATCH_THEME.below,
    // Tightened (was 48) so the rail sits closer under the hero action row.
    paddingTop: scale(24),
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
    fontSize: Math.round(scale(25)),
    lineHeight: Math.round(scale(37)),
    color: WATCH_THEME.text,
  },
})
