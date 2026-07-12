// Series-details screen (/series/[slug]), counterpart of /watch/[slug]: seed paint + GET_SERIES_BY_SLUG (cache-first/returnPartialData); language (U4) in SeriesLanguageProvider.
// Static WATCH_THEME hero, no VideoView (tvOS decode slots, tv-backdrop-videoview-decoder-starvation).
// R1: resolved leaf replace-bounces ONCE to /watch via resolveLeafBounce (shares watch's isSeriesRecord predicate, U5).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Dimensions, ScrollView, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useQuery } from "@apollo/client/react"

import {
  GET_SERIES_BY_SLUG,
  GET_SERIES_LANGUAGES,
} from "../../src/lib/videoQueries"
import {
  normalizeChildDubLanguages,
  normalizeSeries,
} from "../../src/lib/normalizeVideo"
import type { WatchChildLanguage } from "../../src/lib/normalizeVideo"
import { decodeWatchSeed } from "../../src/lib/watchSeed"
import { useSeriesLanguage } from "../../src/contexts/SeriesLanguageContext"
import { resolveTrailerSwap } from "../../src/contexts/seriesLanguageState"
import {
  pickDefaultTrailer,
  resolveLeafBounce,
  resolveScreenState,
  shouldFireFirstRailTiming,
} from "../../src/components/series/seriesScreenState"
import {
  addDatadogTiming,
  isDatadogProvisioned,
  SERIES_FIRST_RAIL_READY_TIMING,
} from "../../src/lib/datadog"
import { isSeriesLabel } from "../../src/lib/isSeriesRecord"
import { EpisodeRail } from "../../src/components/series/EpisodeRail"
import { ScreenStateView } from "../../src/components/ScreenStateView"
import { SeriesActionRow } from "../../src/components/series/SeriesActionRow"
import { SeriesLanguagePanel } from "../../src/components/series/SeriesLanguagePanel"
import { buildMetadataLine } from "../../src/components/watch/detailsHelpers"
import {
  WATCH_THEME,
  HERO_PEEK,
  HERO_BOTTOM_FADE_HEIGHT,
} from "../../src/components/watch/watchDetailTheme"
import { COLORS, hexToRgba } from "../../src/lib/colors"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { scale } from "../../src/lib/scale"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")

// HERO_PEEK / HERO_BOTTOM_FADE_HEIGHT shared with the watch screen. The static
// backdrop renders at full SCREEN_HEIGHT; the hero's overflow:hidden clips its
// bottom HERO_PEEK (top untrimmed) where the rail peeks through.

// Stable fallback for the language panel while no record is resolved — a
// fresh [] each render would re-run the panel's rows memo (the watch screen's
// NO_CITATIONS precedent).
const NO_LANGUAGES: WatchChildLanguage[] = []

export default function SeriesScreen() {
  const { slug, seed: seedParam } = useLocalSearchParams<{
    slug: string
    seed?: string
  }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const router = useRouter()

  const { data, error, loading, refetch } = useQuery(GET_SERIES_BY_SLUG, {
    variables: { locale: "en", slug: decodedSlug },
    skip: !decodedSlug,
    // cache-first (NOT cache-and-network): same rationale as the watch screen
    // — no blocking refetch on re-entry; returnPartialData paints whatever the
    // cache already holds.
    fetchPolicy: "cache-first",
    returnPartialData: true,
  })

  // Keyed on the inner videoBySlug object (NOT the outer `data` wrapper): a
  // new wrapper over an unchanged inner object — common on partial → full
  // transitions — must not re-walk normalizeSeries.
  const record = useMemo(
    () =>
      normalizeSeries(
        (data?.videoBySlug ?? null) as Parameters<typeof normalizeSeries>[0],
      ),
    [data?.videoBySlug],
  )

  // The language union (childDubLanguages) is fetched separately so the hero and
  // episode rail above don't wait on the ~835KB server aggregation. It feeds the
  // panel + hero count from its OWN state; the record carries no languages (KTD1).
  const { data: langData } = useQuery(GET_SERIES_LANGUAGES, {
    variables: { slug: decodedSlug },
    skip: !decodedSlug,
    fetchPolicy: "cache-first",
  })
  const seriesLanguages = useMemo(
    () => normalizeChildDubLanguages(langData?.videoBySlug?.childDubLanguages),
    [langData?.videoBySlug?.childDubLanguages],
  )
  const languagesLoaded = langData?.videoBySlug?.childDubLanguages !== undefined

  // Seed: instant first paint (title + artwork) from data carried by the list
  // surface. Sanitized — a crafted deep link can't reach the image loader.
  const seed = useMemo(() => decodeWatchSeed(seedParam), [seedParam])

  // Leaf bounce (R1): replace (not push) so Menu pops to pre-series origin,
  // once-guarded; seed carries through encoded. Completeness = the lean query's
  // own `children` key present (childDubLanguages moved to a lazy query, so it no
  // longer signals completeness); `!loading` can't tell partial from complete.
  const bounce = resolveLeafBounce(
    record,
    data?.videoBySlug?.children !== undefined,
  )
  const bouncedRef = useRef(false)
  useEffect(() => {
    if (bounce !== "bounce" || bouncedRef.current) return
    bouncedRef.current = true
    const target = seedParam
      ? `/watch/${encodeURIComponent(decodedSlug)}?seed=${seedParam}`
      : `/watch/${encodeURIComponent(decodedSlug)}`
    router.replace(target)
  }, [bounce, decodedSlug, router, seedParam])

  // series_first_rail_ready (R6): once per slug instance, on the first render
  // whose record yields a non-empty rail. Timing lands on the series view the
  // route tracker started (tracker precedes <Stack> in the layout tree).
  const firstRailFiredForRef = useRef<string | null>(null)
  useEffect(() => {
    if (firstRailFiredForRef.current === decodedSlug) return
    if (!isDatadogProvisioned()) return
    if (!shouldFireFirstRailTiming(record)) return
    firstRailFiredForRef.current = decodedSlug
    addDatadogTiming(SERIES_FIRST_RAIL_READY_TIMING)
  }, [record, decodedSlug])

  const screenState = resolveScreenState({ record, seed, error, loading })

  // ── Series language (U4) ───────────────────────────────────────────

  const { selections, setSelection, setActive, clearSeries } =
    useSeriesLanguage()
  const seriesId = record?.documentId ?? null

  // Register ACTIVE on focus (and when identity resolves while focused).
  // Deliberately NO blur cleanup: a pushed episode must keep this active so the
  // watch session carries its selection; a nested series takes over on its focus.
  useFocusEffect(
    useCallback(() => {
      if (seriesId != null) setActive(seriesId)
    }, [seriesId, setActive]),
  )

  // Teardown on UNMOUNT only (pop) — never on blur, or the selection would
  // die the moment an episode opens. Ref-read so the cleanup registered at
  // mount sees the id even when the record resolved later.
  const seriesIdRef = useRef<string | null>(seriesId)
  useEffect(() => {
    seriesIdRef.current = seriesId
  }, [seriesId])
  useEffect(() => {
    return () => {
      if (seriesIdRef.current != null) clearSeries(seriesIdRef.current)
    }
  }, [clearSeries])

  // This screen's own selection (per-series keyed, so a nested series can't
  // clobber it). Survives episode push/pop — the provider outlives the screen.
  const selectedSlug =
    seriesId != null ? (selections.get(seriesId) ?? null) : null

  const [languagePanelVisible, setLanguagePanelVisible] = useState(false)
  // Incremented on every panel close to re-arm the action row's one-shot
  // preferred focus, so the D-pad lands back on the first pill instead of
  // dropping when the Modal's focus trap releases.
  const [actionRowRefocusKey, setActionRowRefocusKey] = useState(0)
  const openLanguagePanel = useCallback(() => {
    setLanguagePanelVisible(true)
  }, [])
  const closeLanguagePanel = useCallback(() => {
    setLanguagePanelVisible(false)
    setActionRowRefocusKey((key) => key + 1)
  }, [])

  // Trailer (R4 / AE9): default = default-language chain's playable dub; a
  // selection swaps it ONLY if playable. `trailerSlug` remembers the last
  // swapping pick so a no-trailer pick keeps the PREVIOUS trailer under focus.
  const [trailerSlug, setTrailerSlug] = useState<string | null>(null)
  const defaultTrailer = useMemo(() => pickDefaultTrailer(record), [record])
  const trailer = useMemo(
    () =>
      resolveTrailerSwap(record, trailerSlug ?? selectedSlug, defaultTrailer),
    [record, trailerSlug, selectedSlug, defaultTrailer],
  )

  const handleLanguageSelect = useCallback(
    (slug: string) => {
      if (seriesId != null) setSelection(seriesId, slug)
      // Probe with a null current so "no playable match" is distinguishable —
      // an unplayable selection must not clear the previous swap.
      if (resolveTrailerSwap(record, slug, null) != null) setTrailerSlug(slug)
      closeLanguagePanel()
    },
    [seriesId, record, setSelection, closeLanguagePanel],
  )

  // Pill sub-caption ALWAYS reflects the SELECTION (AE9 — even when the
  // trailer stayed on a prior dub), falling back to the dub Play Trailer will
  // actually start, then "English".
  const selectedLanguage = useMemo(
    () =>
      selectedSlug != null
        ? (seriesLanguages.find((lang) => lang.slug === selectedSlug) ?? null)
        : null,
    [seriesLanguages, selectedSlug],
  )
  const languageName =
    selectedLanguage != null
      ? (selectedLanguage.name ?? selectedLanguage.slug)
      : (trailer?.languageName ?? "English")

  // First paint prefers resolved data, falls back to seed. CMS posterUrl is
  // untrusted — sanitize before expo-image (seed.imageUrl is already
  // resolveImageUrl-sanitized in decodeWatchSeed; normalizer applies the chain).
  const displayTitle = record?.title ?? seed?.title ?? null
  const displayPoster =
    (record?.posterUrl != null ? resolveImageUrl(record.posterUrl) : null) ??
    seed?.imageUrl ??
    null

  // Hero kicker: badge reads SERIES/COLLECTION, never the raw wire enum —
  // childCount-routed records carry leaf labels (FEATURE_FILM) but this IS the
  // series screen, so all present as series (R3). buildMetadataLine joins slots.
  const badgeLabel = isSeriesLabel(record?.label ?? null)
    ? (record?.label ?? "SERIES")
    : "SERIES"
  const episodeCount = record?.episodes.length ?? 0
  // While the lazy language query is in flight, omit the count slot rather than
  // flashing "0 languages" (the union is never 0 once loaded); it fills in when
  // GET_SERIES_LANGUAGES resolves.
  const languageCount =
    languagesLoaded && seriesLanguages.length > 0
      ? seriesLanguages.length
      : null
  const heroMeta = buildMetadataLine(
    episodeCount > 0
      ? episodeCount === 1
        ? "1 episode"
        : `${episodeCount} episodes`
      : null,
    null,
    languageCount,
  )
  const descriptionText = record?.description ?? null

  if (screenState === "loading") {
    return (
      <View style={styles.screen}>
        <ScreenStateView kind="loading" accent={COLORS.primary} />
      </View>
    )
  }

  if (screenState === "error") {
    return (
      <View style={styles.screen}>
        <ScreenStateView
          kind="error"
          message="This series is temporarily unavailable."
          onRetry={() => {
            void refetch()
          }}
          retryHint="Reloads this series"
          accent={COLORS.primary}
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
        {/* Hero: full-height static artwork with content anchored bottom-left. */}
        <View style={styles.hero}>
          <View
            style={styles.backdrop}
            pointerEvents="none"
            collapsable={false}
          >
            {displayPoster != null ? (
              <Image
                source={{ uri: displayPoster }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                contentPosition="top left"
                recyclingKey={`series-backdrop-${displayPoster}`}
              />
            ) : (
              <View
                style={[StyleSheet.absoluteFill, styles.backdropFallback]}
              />
            )}

            {/* Ambient scrims (left→right + bottom→up) so hero content reads
                over artwork. scrim(0) is an rgba stop, never "transparent"
                (dark banding). collapsable={false} stops Android TV folding. */}
            <LinearGradient
              colors={[
                WATCH_THEME.scrim(0.92),
                WATCH_THEME.scrim(0.55),
                WATCH_THEME.scrim(0),
              ]}
              locations={[0, 0.34, 0.6]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              collapsable={false}
            />
            <LinearGradient
              colors={[
                WATCH_THEME.scrim(0.96),
                WATCH_THEME.scrim(0.5),
                WATCH_THEME.scrim(0),
              ]}
              locations={[0.04, 0.26, 0.52]}
              start={{ x: 0.5, y: 1 }}
              end={{ x: 0.5, y: 0 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              collapsable={false}
            />
          </View>

          {/* Soft fade at the hero's VISIBLE bottom edge blends artwork into the
              rail background (WATCH_THEME.below). Anchored to the hero (not full
              backdrop) for the clipped edge; before heroContent to stay crisp. */}
          <LinearGradient
            colors={[
              hexToRgba(WATCH_THEME.below, 0),
              hexToRgba(WATCH_THEME.below, 0.8),
              WATCH_THEME.below,
            ]}
            locations={[0, 0.65, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.heroBottomFade}
            pointerEvents="none"
            collapsable={false}
          />

          <View style={styles.heroContent}>
            <View style={styles.kicker}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badgeLabel}</Text>
              </View>
              {heroMeta != null ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {heroMeta}
                </Text>
              ) : null}
            </View>

            {displayTitle != null ? (
              <Text style={styles.title} numberOfLines={2}>
                {displayTitle}
              </Text>
            ) : null}

            {descriptionText != null ? (
              <Text style={styles.teaser} numberOfLines={3}>
                {descriptionText}
              </Text>
            ) : null}

            <SeriesActionRow
              trailerHls={trailer?.hls ?? null}
              title={displayTitle}
              languageName={languageName}
              onLanguagePress={openLanguagePanel}
              refocusKey={actionRowRefocusKey}
            />
          </View>
        </View>

        {/* Below the fold — opaque to cover artwork on scroll. Rail/action row
            share the scale(80) gutter and are adjacent, so default D-pad crosses
            both ways. Initial focus stays on the action row (no episode-focus). */}
        <View style={styles.below}>
          {record != null ? (
            <EpisodeRail
              episodes={record.episodes}
              languageSlug={selectedSlug}
            />
          ) : null}
        </View>
      </ScrollView>

      {/* activeSlug falls back to the trailer dub's language so the first open
          lands on what currently plays. The screen owns closing: every path
          funnels through closeLanguagePanel — one close, one refocusKey bump. */}
      <SeriesLanguagePanel
        visible={languagePanelVisible}
        languages={seriesLanguages.length > 0 ? seriesLanguages : NO_LANGUAGES}
        activeSlug={selectedSlug ?? trailer?.languageSlug ?? null}
        onSelect={handleLanguageSelect}
        onClose={closeLanguagePanel}
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
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: scale(20),
    paddingHorizontal: scale(80),
  },

  // ── Hero ──────────────────────────────────────────────────────────
  hero: {
    height: SCREEN_HEIGHT - HERO_PEEK,
    justifyContent: "flex-end",
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  backdrop: {
    // Full-screen height (NOT absoluteFill of the shortened hero) so the cover
    // framing matches a full-height hero — the hero's overflow:hidden clips the
    // bottom HERO_PEEK, which is where the episode rail peeks through.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT,
    overflow: "hidden",
  },
  backdropFallback: {
    backgroundColor: COLORS.surfaceContainer,
  },
  // Soft fade from the artwork into the rail's background at the hero's bottom
  // edge (kills the hard line). Anchored to the hero bottom, behind heroContent.
  heroBottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_BOTTOM_FADE_HEIGHT,
  },
  heroContent: {
    alignItems: "flex-start",
    paddingHorizontal: scale(80),
    // Tightened (was 96) to shrink the dead band between the action row and the
    // episode rail below.
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

  // ── Below the fold (episode rail) ─────────────────────────────────
  below: {
    backgroundColor: WATCH_THEME.below,
    // Tightened (was 48) so the rail sits closer under the hero action row.
    paddingTop: scale(24),
  },

  // ── Error state ───────────────────────────────────────────────────
  errorMessage: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
  },
})
