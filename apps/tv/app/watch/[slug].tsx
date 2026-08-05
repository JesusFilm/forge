// Video-details screen (/watch/[slug]): sanitized seed for instant first paint,
// then GET_VIDEO_BY_SLUG (cache-first + returnPartialData, R3/R21) into the shared
// WatchSession. DEGRADED (R14–R17): empty sections omitted; below-fold last.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/videoQueries"
import { normalizeVideo } from "../../src/lib/normalizeVideo"
import { resolveWatchRedirect } from "../../src/lib/watchRedirect"
import { decodeWatchSeed, encodeWatchSeed } from "../../src/lib/watchSeed"
import { muxHlsUrlFromPlaybackId } from "../../src/lib/muxUrl"
import { validateStreamingUrl } from "../../src/lib/validateUrl"
import { getResumePosition } from "../../src/lib/watchEvents/continueWatching"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useVideoPlayerContext } from "../../src/contexts/VideoPlayerContext"
import { TVFocusGuideView } from "../../src/components/TVFocusGuideView"
import {
  GLIDE_DURATION_MS,
  initialGlideState,
  onGlideSettled,
  onPillBlur,
  onPillFocus,
  type ActionRowPill,
  type GlideState,
} from "../../src/components/watch/actionRowScrollGlide"
import { VideoBackdrop } from "../../src/components/watch/VideoBackdrop"
import { ScreenStateView } from "../../src/components/ScreenStateView"
import { DetailsActionRow } from "../../src/components/watch/DetailsActionRow"
import { UpNextRail } from "../../src/components/watch/UpNextRail"
import { AboutSection } from "../../src/components/watch/AboutSection"
import {
  CHAPTER_NOUN,
  EpisodeRail,
} from "../../src/components/series/EpisodeRail"
import { LanguagePanel } from "../../src/components/watch/LanguagePanel"
import { SubtitlePanel } from "../../src/components/watch/SubtitlePanel"
import {
  buildBibleQuotesBlock,
  buildRelatedQuestionsBlock,
} from "../../src/components/watch/detailsAdapters"
import {
  buildMetadataLine,
  formatBadgeLabel,
  shouldShowUpNextRail,
} from "../../src/components/watch/detailsHelpers"
import {
  WATCH_THEME,
  HERO_PEEK,
} from "../../src/components/watch/watchDetailTheme"
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

// tvOS-only: the glide's ordering contract (new pill's focus before old pill's
// blur — see actionRowScrollGlide.ts) is INVERTED on Android TV, and Android's
// ScrollView already arrow-scrolls the page natively on D-pad, so the JS glide
// would fight it frame-by-frame. On react-native-tvos, tvOS is Platform.OS "ios".
const GLIDE_ENABLED = Platform.OS === "ios"

type ActivePanel = "none" | "language" | "subtitle"

export default function WatchVideoScreen() {
  const {
    slug,
    seed: seedParam,
    autoplay: autoplayParam,
  } = useLocalSearchParams<{
    slug: string
    seed?: string
    autoplay?: string
  }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const router = useRouter()

  const { video, setVideo, activeVariant } = useWatchSession()
  const {
    state: playerState,
    decoderClaimed,
    playVideo,
  } = useVideoPlayerContext()

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

  // Continue Watching → straight into playback (feat-322). The shelf card
  // routes here with autoplay=1; once the session resolves a playable variant
  // we open the player at the position READ FROM STORAGE — never a position
  // implied by the card's hover preview, which is a decorative image and
  // writes nothing. One-shot per screen instance: the latch keeps a Back out
  // of the player from bouncing the viewer straight back into it.
  const autoplayConsumedRef = useRef(false)
  useEffect(() => {
    if (autoplayParam !== "1" || autoplayConsumedRef.current) return
    if (playerState.isVisible) return
    const hls = activeVariant?.hls
    const videoId = video?.documentId
    if (!hls || !videoId || !validateStreamingUrl(hls)) return

    let cancelled = false
    void (async () => {
      const position = await getResumePosition(videoId)
      // Re-check after the await: the viewer may have left, or opened the
      // player themselves, while storage was being read.
      if (cancelled || autoplayConsumedRef.current) return
      autoplayConsumedRef.current = true
      playVideo(
        hls,
        video?.title ?? undefined,
        undefined,
        { videoId, videoDubId: activeVariant?.documentId ?? null },
        position ?? undefined,
      )
    })()
    return () => {
      cancelled = true
    }
  }, [autoplayParam, activeVariant, video, playVideo, playerState.isVisible])

  const [activePanel, setActivePanel] = useState<ActivePanel>("none")
  // Stable identity: this lands in the panels' renderRow useCallback deps —
  // an inline arrow would rebuild renderRow (re-rendering all mounted FlatList
  // rows) on every screen render while a sheet is open.
  const closePanel = useCallback(() => setActivePanel("none"), [])

  // The action row traps D-pad UP (see DetailsActionRow), so once the page has
  // scrolled down there'd be no way back to the full hero. Returning focus to
  // the row glides the page to the top instead. A JS-driven eased timing rather
  // than scrollTo({animated:true}) — the native curve is a fixed ~300ms, too
  // abrupt for a full-viewport return — so the listener writes each frame with
  // scrollTo({animated:false}). All the ORDERING decisions live in the pure,
  // tested actionRowScrollGlide module; this is just the Animated plumbing.
  const scrollRef = useRef<ScrollView>(null)
  const scrollYRef = useRef(0)
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollYRef.current = event.nativeEvent.contentOffset.y
    },
    [],
  )
  const scrollTopAnim = useMemo(() => new Animated.Value(0), [])
  useEffect(() => {
    const id = scrollTopAnim.addListener(({ value }) => {
      scrollRef.current?.scrollTo({ y: value, animated: false })
    })
    // Stop the timing too: a listener-less animation would keep ticking after
    // unmount and resolve into a scrollTo on a dead ref.
    return () => {
      scrollTopAnim.removeListener(id)
      scrollTopAnim.stopAnimation()
    }
  }, [scrollTopAnim])
  const glideRef = useRef<GlideState>(initialGlideState)
  const handleActionRowFocus = useCallback(
    (pill: ActionRowPill) => {
      // stopAnimation yields the animation's CURRENT value, which is the only
      // trustworthy offset mid-glide — scrollYRef lags it by a throttle window
      // and would snap the page backwards before resuming.
      scrollTopAnim.stopAnimation((liveY) => {
        const { state, action } = onPillFocus(glideRef.current, pill, {
          settledY: scrollYRef.current,
          liveY,
        })
        glideRef.current = state
        if (action.kind !== "start") return
        scrollTopAnim.setValue(action.fromY)
        Animated.timing(scrollTopAnim, {
          toValue: 0,
          duration: GLIDE_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          // Per-frame scrollTo needs the JS-side listener above.
          useNativeDriver: false,
        }).start(({ finished }) => {
          // finished:false is a stopAnimation from a cancel OR a mid-glide
          // restart; the restart has already set gliding:true for the NEW
          // glide, so settling here would make its next hop seed from the
          // lagging settledY (the backward hitch the module exists to avoid).
          if (finished) glideRef.current = onGlideSettled(glideRef.current)
        })
      })
    },
    [scrollTopAnim],
  )
  const handleActionRowBlur = useCallback(
    (pill: ActionRowPill) => {
      const { state, action } = onPillBlur(glideRef.current, pill)
      glideRef.current = state
      if (action.kind === "cancel") scrollTopAnim.stopAnimation()
    },
    [scrollTopAnim],
  )

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

  // Hero kicker: the label becomes the badge chip ("FEATURE FILM"); the meta line
  // carries duration + language count (label omitted — it's now the badge).
  const badgeLabel = formatBadgeLabel(video?.label)
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
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {/* Hero: backdrop fills the HERO_PEEK-shortened hero so video clips by
            construction (full-height VideoView punches through Up Next on Android —
            SurfaceView ignores overflow:hidden). bottomFadeColor fades inside it. */}
        <View style={styles.hero}>
          <VideoBackdrop
            streamingUrl={backdropSource ?? null}
            posterUrl={displayPoster}
            // decoderClaimed: Showcase Mode holds the only decode slot while it
            // runs (KTD-1). This backdrop has no focus gate, so the claim is the
            // one thing that unmounts it if the showcase ever runs above it.
            overlayVisible={playerState.isVisible || decoderClaimed}
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
              onRowFocus={GLIDE_ENABLED ? handleActionRowFocus : undefined}
              onRowBlur={GLIDE_ENABLED ? handleActionRowBlur : undefined}
            />
          </View>
        </View>

        {/* Below the fold — opaque so it covers the backdrop as the user scrolls. */}
        <View style={styles.below}>
          {/* Chapters and Up Next are mutually exclusive (shouldShowUpNextRail):
              a film with its own chapter clips shows only those, since Up Next
              is the PARENT's other children — a different, noisier relation. */}
          {hasVideo && video.chapters.length > 0 ? (
            <EpisodeRail episodes={video.chapters} noun={CHAPTER_NOUN} />
          ) : null}

          {hasVideo && shouldShowUpNextRail(video) ? (
            <UpNextRail siblings={video.siblings} />
          ) : null}

          {/* About + Related Questions share a two-column row. TVFocusGuideView
              spans the row so vertical D-pad reaches both columns. About is
              focusable in its own right (AboutSection) — it must never depend on
              a sibling column to be reachable, or it vanishes on videos with no
              study questions. */}
          {descriptionText != null || relatedQuestionsBlock != null ? (
            <TVFocusGuideView autoFocus style={styles.aboutRow}>
              {descriptionText != null ? (
                <View style={styles.aboutCol}>
                  <AboutSection description={descriptionText} />
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
})
