import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AppState,
  BackHandler,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Image } from "expo-image"
import { StatusBar } from "expo-status-bar"
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_SERIES_BY_SLUG } from "../../src/lib/queries"
import {
  normalizeSeries,
  type WatchEpisode,
} from "../../src/lib/normalizeVideo"
import { decodeWatchSeed, encodeWatchSeed } from "../../src/lib/watchSeed"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { ACCENT, SURFACE_COLOR } from "../../src/lib/color"
import { layout, text } from "../../src/styles/shared"
import { useTypography } from "../../src/hooks/useTypography"
import { VideoPlayer } from "../../src/components/watch/VideoPlayer"
import {
  enterFullscreenLandscape,
  exitToPortrait,
} from "../../src/lib/orientation"
import { VideoDetailSkeleton } from "../../src/components/watch/VideoDetailSkeleton"
import { VideoMetadata } from "../../src/components/watch/VideoMetadata"
import { VideoDescription } from "../../src/components/watch/VideoDescription"
import { SeriesActionRow } from "../../src/components/watch/SeriesActionRow"
import { SeriesEpisodesGrid } from "../../src/components/series/SeriesEpisodesGrid"
import { useSeriesSession } from "../../src/contexts/SeriesSessionProvider"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { deriveSeriesDownloadState } from "../../src/lib/seriesDownloadAggregate"

const EMPTY_EPISODES: WatchEpisode[] = []

// Series detail screen. Hero is pinned at the route root (outside the ScrollView)
// so custom fullscreen never reparents: VideoPlayer when there's a trailer, else
// a poster (no player). It holds the only decoder slot; the grid is static images.
export default function SeriesScreen() {
  const { slug, seed: seedParam } = useLocalSearchParams<{
    slug: string
    seed?: string
  }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""

  const navigation = useNavigation()
  const router = useRouter()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), [])
  const typography = useTypography()

  const { series, setSeries, languages, selectedLanguageSlug } =
    useSeriesSession()
  const { downloadedSlugs, offlineRecords } = useDownloads()

  const downloadState = useMemo(
    () =>
      deriveSeriesDownloadState(
        series?.episodes.map((episode) => episode.slug) ?? [],
        downloadedSlugs,
        offlineRecords,
      ),
    [series?.episodes, downloadedSlugs, offlineRecords],
  )

  const { data, loading, error, refetch } = useQuery(GET_SERIES_BY_SLUG, {
    variables: { slug: decodedSlug, locale: "en" },
    skip: !decodedSlug,
    fetchPolicy: "cache-first",
    returnPartialData: true,
  })

  const normalized = useMemo(
    // returnPartialData widens videoBySlug to a deep-partial type; normalizeSeries
    // tolerates missing fields (returns null without a documentId).
    () =>
      normalizeSeries(
        (data?.videoBySlug ?? null) as Parameters<typeof normalizeSeries>[0],
      ),
    [data],
  )

  useEffect(() => {
    if (normalized) setSeries(normalized)
  }, [normalized, setSeries])

  const seed = useMemo(() => decodeWatchSeed(seedParam), [seedParam])

  // Fullscreen side-effects — the same three the watch screen runs, so the
  // reused player's custom fullscreen rotates and toggles the header in step.
  useEffect(() => {
    navigation.setOptions({
      headerShown: !isFullscreen,
      gestureEnabled: !isFullscreen,
      orientation: isFullscreen ? "landscape" : "portrait",
    })
    if (isFullscreen) void enterFullscreenLandscape()
    else void exitToPortrait()
  }, [isFullscreen, navigation])

  useEffect(() => {
    if (!isFullscreen) return
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      setIsFullscreen(false)
      return true
    })
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") void enterFullscreenLandscape()
    })
    return () => {
      back.remove()
      app.remove()
    }
  }, [isFullscreen])

  useEffect(() => {
    return () => {
      void exitToPortrait()
    }
  }, [])

  const displayTitle = series?.title ?? seed?.title ?? null
  const displayPoster = resolveImageUrl(
    series?.posterUrl ?? seed?.imageUrl ?? null,
  )

  // Trailer follows the selected language (series' dub for it, else first playable
  // dub). Resolved only from the loaded series, never the seed, so a series with
  // no trailer never mounts a player.
  const trailerHls = useMemo(() => {
    if (!series) return null
    const forLanguage = series.variants.find(
      (v) =>
        v.languageSlug === selectedLanguageSlug &&
        v.hls != null &&
        v.hls !== "",
    )
    return forLanguage?.hls ?? series.streamingUrl
  }, [series, selectedLanguageSlug])

  const hasSeries = series != null
  const hasTrailer = trailerHls != null

  const handleShare = useCallback(() => {
    if (!series) return
    // Public watch URL is /watch/{slug}.html/{language}.html (verified 200);
    // the bare /{slug}.html form without /watch/ 404s.
    const base = `https://www.jesusfilm.org/watch/${series.slug}.html`
    const shareUrl = selectedLanguageSlug
      ? `${base}/${selectedLanguageSlug}.html`
      : base
    // Share.share rejects when the OS share sheet is dismissed/unavailable;
    // swallow it so it never surfaces as an unhandled rejection.
    void Share.share({
      message: shareUrl,
      title: series.title ?? undefined,
    }).catch(() => {})
  }, [series, selectedLanguageSlug])

  // Tap an episode → its detail page. Language carries via the persisted
  // WatchPreferences audio slug (the watch screen resolves its dub from it), so
  // it's not threaded through nav params. The seed paints the hero instantly.
  const handleSelectEpisode = useCallback(
    (episode: WatchEpisode) => {
      const seed = encodeWatchSeed({
        slug: episode.slug,
        title: episode.title,
        imageUrl: episode.posterUrl,
        playbackId: null,
      })
      router.push(`/watch/${encodeURIComponent(episode.slug)}?seed=${seed}`)
    },
    [router],
  )

  // Cold deep link with nothing to paint yet → skeleton, not a blank spinner.
  if (!hasSeries && seed == null && loading) {
    return (
      <View style={layout.screenContainer}>
        <VideoDetailSkeleton />
      </View>
    )
  }

  // No series, no seed, not loading → genuinely nothing to show.
  if (!hasSeries && seed == null) {
    return (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>Series Not Found</Text>
        <Text style={text.errorMessage}>
          {error?.message ?? "This series could not be loaded."}
        </Text>
        <Text
          style={styles.retryLink}
          onPress={() => void refetch()}
          accessibilityRole="button"
        >
          Retry
        </Text>
      </View>
    )
  }

  return (
    <View style={layout.screenContainer}>
      <StatusBar style="light" hidden={isFullscreen} />

      {hasSeries && hasTrailer ? (
        <VideoPlayer
          streamingUrl={trailerHls}
          posterUrl={displayPoster}
          fullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      ) : (
        <View
          style={styles.posterHero}
          accessible={true}
          accessibilityRole="image"
          accessibilityLabel={
            displayTitle ? `${displayTitle} poster` : "Series poster"
          }
        >
          {displayPoster != null && (
            <Image
              source={{ uri: displayPoster }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={series?.documentId ?? decodedSlug}
            />
          )}
        </View>
      )}

      <SeriesEpisodesGrid
        episodes={hasSeries ? series.episodes : EMPTY_EPISODES}
        onSelect={handleSelectEpisode}
        header={
          <>
            <VideoMetadata
              label={series?.label ?? "SERIES"}
              title={displayTitle}
              subtitle={null}
            />

            {hasSeries ? (
              <>
                <SeriesActionRow
                  onLanguage={() => router.push("/series/language")}
                  onDownload={() => router.push("/series/download")}
                  onShare={handleShare}
                  languageLabel={
                    languages.find((l) => l.slug === selectedLanguageSlug)
                      ?.name ?? null
                  }
                  downloadState={downloadState}
                />
                <VideoDescription description={series.description} />
                {series.episodes.length > 0 && (
                  <Text
                    style={[
                      text.sectionHeadingPadded,
                      typography.titleLarge,
                      styles.gridHeading,
                    ]}
                  >
                    Videos
                  </Text>
                )}
              </>
            ) : (
              <>
                {error != null && (
                  <View style={styles.inlineError}>
                    <Text style={text.errorMessage}>
                      Couldn&apos;t load full details.
                    </Text>
                    <Text
                      style={styles.retryLink}
                      onPress={() => void refetch()}
                      accessibilityRole="button"
                    >
                      Retry
                    </Text>
                  </View>
                )}
                <VideoDetailSkeleton variant="sections" />
              </>
            )}
          </>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  posterHero: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: SURFACE_COLOR,
  },
  gridHeading: {
    marginTop: 12,
    marginBottom: 2,
  },
  inlineError: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  retryLink: {
    color: ACCENT,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 12,
    textAlign: "center",
  },
})
