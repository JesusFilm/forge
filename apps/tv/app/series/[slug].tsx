// Series-details screen — /series/[slug].
//
// The series counterpart of /watch/[slug]: paints from an (untrusted,
// sanitized) seed for instant first paint, then fills in from
// GET_SERIES_BY_SLUG (cache-first + returnPartialData so re-entry reads the
// warm cache without a blocking refetch). No watch-session publish — trailer
// playback uses the overlay's no-session path (see SeriesActionRow), and the
// series language state arrives in U4 via a dedicated provider.
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

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_SERIES_BY_SLUG } from "../../src/lib/videoQueries"
import { normalizeSeries } from "../../src/lib/normalizeVideo"
import { decodeWatchSeed } from "../../src/lib/watchSeed"
import {
  pickPlayableTrailer,
  resolveLeafBounce,
  resolveScreenState,
} from "../../src/components/series/seriesScreenState"
import { EpisodeRail } from "../../src/components/series/EpisodeRail"
import { SeriesActionRow } from "../../src/components/series/SeriesActionRow"
import { buildMetadataLine } from "../../src/components/watch/detailsHelpers"
import { WATCH_THEME } from "../../src/components/watch/watchDetailTheme"
import { COLORS } from "../../src/lib/colors"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { scale } from "../../src/lib/scale"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")

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
  const bounce = resolveLeafBounce(record, !loading && error == null)
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

  // Trailer: the series' own first playable dub (R4). U4 swaps this per the
  // selected language; until then the Language pill captions the trailer
  // dub's language — the dub Play Trailer will actually start.
  const trailer = pickPlayableTrailer(record)
  const languageName = trailer?.languageName ?? "English"

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

  // Hero kicker: the label badge (defaulting to SERIES while only the seed
  // has painted — this IS the series screen; a leaf bounces away anyway) and
  // a meta line. buildMetadataLine is a joined-segments builder: its first
  // slot carries the episode count, the third the childDubLanguages count.
  const badgeLabel = record?.label ?? "SERIES"
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
            pill): resolveInitialFocus's "episodes" branch is intentionally
            unwired — arming hasTVPreferredFocus inside the rail would fight
            the action row's one-shot, and landing focus below the fold
            would scroll past the hero on entry. */}
        <View style={styles.below}>
          {record != null ? <EpisodeRail episodes={record.episodes} /> : null}
        </View>
      </ScrollView>
    </View>
  )
}

/**
 * Focusable "Try again" control for the error state. Mirrors the watch
 * screen's RetryButton (not exported there): onFocus / onBlur + state rather
 * than the `({ focused }) => [...]` callback — `focused` is exposed at runtime
 * by react-native-tvos but not by the upstream PressableStateCallbackType, so
 * the callback form fails the strict tsc check.
 */
function RetryButton({ onPress }: { onPress: () => void }) {
  const [isFocused, setIsFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Try again"
      accessibilityHint="Reloads this series"
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
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: scale(20),
    paddingHorizontal: scale(80),
  },

  // ── Hero ──────────────────────────────────────────────────────────
  hero: {
    height: SCREEN_HEIGHT,
    justifyContent: "flex-end",
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  backdropFallback: {
    backgroundColor: COLORS.surfaceContainer,
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

  // ── Below the fold (episode rail) ─────────────────────────────────
  below: {
    backgroundColor: WATCH_THEME.below,
    paddingTop: scale(48),
  },

  // ── Error state ───────────────────────────────────────────────────
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
