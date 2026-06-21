// Series-details screen — /series/[slug].
//
// The series counterpart of /watch/[slug]: paints from an (untrusted,
// sanitized) seed for instant first paint, then fills in from
// GET_SERIES_BY_SLUG (cache-first + returnPartialData so re-entry reads the
// warm cache without a blocking refetch). No watch-session publish — trailer
// playback uses the overlay's no-session path (see SeriesActionRow).
//
// Language (U4): the screen's selection lives in SeriesLanguageProvider,
// keyed by this series' documentId, so it survives episode push/pop and
// nested series stacking. The screen registers itself ACTIVE on focus (the
// watch session carries the active series' selection into opened episodes)
// and deletes its entry on unmount. Selecting a language best-effort swaps
// the trailer dub (resolveTrailerSwap) and threads the slug to the episode
// rail's `lang` param.
//
// Layout (WATCH_THEME for visual continuity with the watch screen): a
// full-height STATIC artwork hero — expo-image + the watch backdrop's ambient
// gradient scrims, never a VideoBackdrop. No video mounts on this screen:
// tvOS decode slots are scarce, and the fullscreen overlay must own the only
// decoder (see tv-backdrop-videoview-decoder-starvation). Hero content sits
// bottom-left: SERIES badge + meta kicker (episodes · languages), large
// title, 3-line teaser, and the Play Trailer / Language action row. Below the
// fold (opaque): the episode rail (U3).
//
// Routing (R1): when the resolved record turns out to be a leaf,
// router.replace ONCE to /watch/[slug] carrying the original seed through —
// resolveLeafBounce evaluates the same isSeriesRecord predicate as the watch
// route's series redirect (U5), so the two seams can never disagree and loop.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_SERIES_BY_SLUG } from "../../src/lib/videoQueries"
import { normalizeSeries } from "../../src/lib/normalizeVideo"
import type { WatchChildLanguage } from "../../src/lib/normalizeVideo"
import { decodeWatchSeed } from "../../src/lib/watchSeed"
import { useSeriesLanguage } from "../../src/contexts/SeriesLanguageContext"
import { resolveTrailerSwap } from "../../src/contexts/seriesLanguageState"
import {
  pickDefaultTrailer,
  resolveLeafBounce,
  resolveScreenState,
} from "../../src/components/series/seriesScreenState"
import { isSeriesLabel } from "../../src/lib/isSeriesRecord"
import { EpisodeRail } from "../../src/components/series/EpisodeRail"
import { RetryButton } from "../../src/components/RetryButton"
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

// HERO_PEEK / HERO_BOTTOM_FADE_HEIGHT are shared with the watch screen (see
// watchDetailTheme). The series backdrop is a static expo-image, so — unlike the
// watch screen's VideoView — it renders at full SCREEN_HEIGHT and the hero's
// overflow:hidden clips its bottom HERO_PEEK (thumbnail framing stays full, top
// not trimmed); the rail peeks through there.

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

  // Seed: instant first paint (title + artwork) from data carried by the list
  // surface. Sanitized — a crafted deep link can't reach the image loader.
  const seed = useMemo(() => decodeWatchSeed(seedParam), [seedParam])

  // Leaf bounce (R1): replace (not push) so Menu pops to the pre-series
  // origin, once-guarded so a partial→full re-evaluation can't fire twice.
  // The original seed param carries through as-is (it arrives still-encoded).
  // Completeness signal: the series-only childDubLanguages key exists on the
  // raw object (even as []) only once THIS query has answered — the watch
  // screen's warm partial reads back with loading=false under cache-first +
  // returnPartialData, so `!loading` cannot tell partial from complete.
  const bounce = resolveLeafBounce(
    record,
    data?.videoBySlug?.childDubLanguages !== undefined,
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

  const screenState = resolveScreenState({ record, seed, error, loading })

  // ── Series language (U4) ───────────────────────────────────────────

  const { selections, setSelection, setActive, clearSeries } =
    useSeriesLanguage()
  const seriesId = record?.documentId ?? null

  // Register as the ACTIVE series screen on focus (and again when the record's
  // identity resolves while focused). Deliberately NO blur cleanup: pushing an
  // episode blurs this screen but must keep it active so the watch session
  // carries its selection; a nested series screen takes over by registering
  // itself on its own focus.
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

  // Trailer (R4 / AE9): default = the playable dub the default-language
  // chain picks (device → primary → English → first playable, matching the
  // watch screen); a selection swaps it ONLY when that language has a
  // playable dub on the series record. `trailerSlug` remembers the last
  // selection that DID swap, so a later no-trailer selection keeps the
  // PREVIOUS trailer (not the default) and the Play Trailer action never
  // disappears under focus. On re-entry the surviving selection seeds it.
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
        ? (record?.languages.find((lang) => lang.slug === selectedSlug) ?? null)
        : null,
    [record?.languages, selectedSlug],
  )
  const languageName =
    selectedLanguage != null
      ? (selectedLanguage.name ?? selectedLanguage.slug)
      : (trailer?.languageName ?? "English")

  // First paint prefers resolved data, falling back to the seed. CMS posterUrl
  // is untrusted — sanitize before it reaches expo-image (the seed.imageUrl
  // branch is already resolveImageUrl-sanitized in decodeWatchSeed). The
  // normalizer's posterUrl already applies the image precedence chain
  // (mobileCinematicHigh → url → thumbnail), same as the watch screen.
  const displayTitle = record?.title ?? seed?.title ?? null
  const displayPoster =
    (record?.posterUrl != null ? resolveImageUrl(record.posterUrl) : null) ??
    seed?.imageUrl ??
    null

  // Hero kicker: the badge reads SERIES/COLLECTION — never the raw wire enum.
  // Records routed here by childCount alone carry leaf labels (FEATURE_FILM),
  // which would render underscores verbatim; this IS the series screen, so
  // anything rendering here presents as a series (R3). buildMetadataLine is a
  // joined-segments builder: first slot episode count, third language count.
  const badgeLabel = isSeriesLabel(record?.label ?? null)
    ? (record?.label ?? "SERIES")
    : "SERIES"
  const episodeCount = record?.episodes.length ?? 0
  const heroMeta = buildMetadataLine(
    episodeCount > 0
      ? episodeCount === 1
        ? "1 episode"
        : `${episodeCount} episodes`
      : null,
    null,
    record?.languages.length ?? null,
  )
  const descriptionText = record?.description ?? null

  if (screenState === "loading") {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    )
  }

  if (screenState === "error") {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.errorMessage}>
          This series is temporarily unavailable.
        </Text>
        <RetryButton
          onPress={() => {
            void refetch()
          }}
          accessibilityHint="Reloads this series"
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
                recyclingKey={`series-backdrop-${displayPoster}`}
              />
            ) : (
              <View
                style={[StyleSheet.absoluteFill, styles.backdropFallback]}
              />
            )}

            {/* Ambient scrims (VideoBackdrop's left→right + bottom→up pair) so
                the hero content reads over the artwork. scrim(0) is an rgba
                stop — never the "transparent" keyword (dark banding). The
                gradient/image layers use collapsable={false} so Android TV
                can't fold them away. */}
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

          {/* Soft fade at the hero's VISIBLE bottom edge → blends the artwork
              into the episode rail's background (WATCH_THEME.below) instead of a
              hard cut. Anchored to the hero (not the full-height backdrop) so it
              sits exactly at the clipped bottom edge; rendered before heroContent
              so the title/buttons stay crisp on top. */}
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

        {/* Below the fold — opaque so it covers the artwork as the user
            scrolls. The rail's TVFocusGuideView sits vertically adjacent to
            the action row's inside this same ScrollView and they overlap
            horizontally (both start at the scale(80) gutter), so default
            D-pad traversal crosses between them in both directions — the
            same structure the watch screen ships (DetailsActionRow ↔
            UpNextRail), no explicit destinations needed. Initial focus stays
            with the action row even when no trailer exists (the Language
            pill): a first-episode initial-focus branch is intentionally
            unwired — arming hasTVPreferredFocus inside the rail would fight
            the action row's one-shot, and landing focus below the fold
            would scroll past the hero on entry. */}
        <View style={styles.below}>
          {record != null ? (
            <EpisodeRail
              episodes={record.episodes}
              languageSlug={selectedSlug}
            />
          ) : null}
        </View>
      </ScrollView>

      {/* activeSlug falls back to the trailer dub's language so the first
          open lands on (and scrolls to) what currently plays. The screen owns
          closing: handleLanguageSelect persists the pick, swaps the trailer
          when playable, and funnels into closeLanguagePanel — one close path,
          one refocusKey increment. */}
      <SeriesLanguagePanel
        visible={languagePanelVisible}
        languages={record?.languages ?? NO_LANGUAGES}
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
    fontSize: Math.round(scale(25)),
    lineHeight: Math.round(scale(36)),
    fontWeight: "400",
    color: WATCH_THEME.text74,
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
