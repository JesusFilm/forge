import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Image } from "expo-image"
import { StatusBar } from "expo-status-bar"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useQuery } from "@apollo/client/react"
import { useSafeAreaInsets } from "react-native-safe-area-context"

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
import { useFullscreenPresentation } from "../../src/hooks/useFullscreenPresentation"
import { BACK_BUTTON_PROPS } from "../../src/lib/playerLayout"
import { buildWatchShareUrl } from "../../src/lib/watchShareUrl"
import { VideoDetailSkeleton } from "../../src/components/watch/VideoDetailSkeleton"
import { VideoMetadata } from "../../src/components/watch/VideoMetadata"
import { VideoDescription } from "../../src/components/watch/VideoDescription"
import { SeriesActionRow } from "../../src/components/watch/SeriesActionRow"
import { SeriesEpisodesGrid } from "../../src/components/series/SeriesEpisodesGrid"
import { FloatingBackButton } from "../../src/components/ui/FloatingBackButton"
import { Snackbar } from "../../src/components/ui/Snackbar"
import { useSeriesSession } from "../../src/contexts/SeriesSessionProvider"
import { useWatchPreferences } from "../../src/contexts/WatchPreferencesProvider"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import {
  deriveEpisodeBadges,
  deriveSeriesDownloadState,
  seriesAllDownloaded,
} from "../../src/lib/seriesDownloadAggregate"
import { resolveSeriesSubtitleLabel } from "../../src/lib/subtitleSelection"
import { useSeriesSubtitleUnion } from "../../src/hooks/useSeriesSubtitleUnion"

const EMPTY_EPISODES: WatchEpisode[] = []

// Series detail screen. A trailer plays in a VideoPlayer PINNED at the route root
// (outside the list) so fullscreen never reparents and scrolling can't obscure it.
// A poster-only hero instead scrolls away in the grid header.
export default function SeriesScreen() {
  const { slug, seed: seedParam } = useLocalSearchParams<{
    slug: string
    seed?: string
  }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""

  const router = useRouter()
  const { isFullscreen, toggleFullscreen } = useFullscreenPresentation()
  const typography = useTypography()
  const insets = useSafeAreaInsets()

  const { series, setSeries, languages, selectedLanguageSlug } =
    useSeriesSession()
  const {
    downloadedSlugs,
    offlineRecords,
    pendingSwapSlugs,
    getRecord,
    deleteDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
  } = useDownloads()
  const { subtitleLanguageSlug, subtitleLanguageName, subtitlesEnabled } =
    useWatchPreferences()

  // Reconcile the persisted subtitle pref against what this series offers — an
  // unsupported pref falls back. Fetched only when a subtitle is set; the pill
  // paints the cached name optimistically until the union lands.
  const { subtitles: subtitleUnion, error: subtitleUnionError } =
    useSeriesSubtitleUnion(
      series?.episodes ?? null,
      selectedLanguageSlug,
      subtitlesEnabled && subtitleLanguageSlug != null,
    )
  const subtitleActionLabel = resolveSeriesSubtitleLabel(
    subtitlesEnabled,
    subtitleLanguageSlug,
    subtitleLanguageName,
    subtitleUnion,
    series?.primaryLanguageBcp47 ?? null,
  )
  // Bright only when subtitles are on, a language is set, the union didn't error,
  // and the series has tracks — otherwise the pill reads "Off"/placeholder, muted.
  const subtitleActive =
    subtitlesEnabled &&
    subtitleLanguageSlug != null &&
    !subtitleUnionError &&
    (subtitleUnion == null || subtitleUnion.length > 0)

  const downloadState = useMemo(
    () =>
      deriveSeriesDownloadState(
        series?.episodes.map((episode) => episode.slug) ?? [],
        downloadedSlugs,
        offlineRecords,
        pendingSwapSlugs,
      ),
    [series?.episodes, downloadedSlugs, offlineRecords, pendingSwapSlugs],
  )
  const seriesFullyDownloaded = seriesAllDownloaded(downloadState)

  // Toast a genuine series-completion: sawDownloadActivityRef skips a fresh mount
  // of an already-saved series; cancellingRef skips a cancel-revert (also lands
  // fully-downloaded). `queued` keeps inProgress true between sequential episodes.
  const [seriesSnackbar, setSeriesSnackbar] = useState<string | null>(null)
  const sawDownloadActivityRef = useRef(false)
  const cancellingRef = useRef(false)
  useEffect(() => {
    if (downloadState.inProgress) {
      sawDownloadActivityRef.current = true
      return
    }
    if (!sawDownloadActivityRef.current) return
    // Activity ended: consume both latches; toast only a genuine completion.
    sawDownloadActivityRef.current = false
    const wasCancelling = cancellingRef.current
    cancellingRef.current = false
    if (!wasCancelling && seriesFullyDownloaded) {
      setSeriesSnackbar("Series downloaded")
    }
  }, [downloadState.inProgress, seriesFullyDownloaded])

  const badgeBySlug = useMemo(
    () =>
      deriveEpisodeBadges(
        series?.episodes.map((episode) => episode.slug) ?? [],
        offlineRecords,
      ),
    [series?.episodes, offlineRecords],
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
    // Share.share rejects when the OS share sheet is dismissed/unavailable;
    // swallow it so it never surfaces as an unhandled rejection.
    void Share.share({
      message: buildWatchShareUrl(series.slug, selectedLanguageSlug),
      title: series.title ?? undefined,
    }).catch(() => {})
  }, [series, selectedLanguageSlug])

  const openDownloadSheet = useCallback(
    () => router.push("/series/download"),
    [router],
  )

  // Manage control once the whole series is saved — mirrors the single-video
  // manage flow (app/watch/[slug]) as a native iOS action sheet (HIG: a menu, not
  // an alert), offering change-quality/subtitles + remove-all.
  const handleManageDownloads = useCallback(() => {
    const savedSlugs = (series?.episodes ?? [])
      .map((episode) => episode.slug)
      .filter((slug) => getRecord(slug) != null)
    const seriesTitle = series?.title ?? "this series"

    const confirmRemoveAll = () => {
      Alert.alert(
        "Remove downloads?",
        `This removes all ${savedSlugs.length} downloaded ${
          savedSlugs.length === 1 ? "episode" : "episodes"
        } for “${seriesTitle}.” You can download them again anytime.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              // Sequential so the manifest index isn't raced across writes.
              void (async () => {
                for (const slug of savedSlugs) await deleteDownload(slug)
              })()
            },
          },
        ],
      )
    }

    // The download sheet changes quality + subtitles for the current audio
    // language (audio language is set via the language pill, not here). Same-
    // language quality/subtitle re-download is a known no-op (decideEpisodeAction).
    const CHANGE = "Change quality or subtitles"
    const REMOVE = "Remove all downloads"
    const savedCount = downloadState.total
    const savedLabel = `${savedCount} ${
      savedCount === 1 ? "episode" : "episodes"
    } saved for offline viewing`
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: seriesTitle,
          message: savedLabel,
          options: [CHANGE, REMOVE, "Cancel"],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
          // App is dark-only; keep the sheet in step rather than following the OS.
          userInterfaceStyle: "dark",
        },
        (index) => {
          if (index === 0) openDownloadSheet()
          else if (index === 1) confirmRemoveAll()
        },
      )
    } else {
      Alert.alert(seriesTitle, savedLabel, [
        { text: CHANGE, onPress: openDownloadSheet },
        { text: REMOVE, style: "destructive", onPress: confirmRemoveAll },
        { text: "Cancel", style: "cancel" },
      ])
    }
  }, [
    series?.episodes,
    series?.title,
    downloadState.total,
    getRecord,
    deleteDownload,
    openDownloadSheet,
  ])

  // Downloading → the ring's pause glyph pauses the active transfer (the pump
  // then holds, so the whole batch pauses).
  const handlePauseAll = useCallback(() => {
    downloadState.inFlightSlugs.forEach((slug) => void pauseDownload(slug))
  }, [downloadState.inFlightSlugs, pauseDownload])

  // Paused → the ring's play glyph opens a sheet: resume, or cancel the batch
  // (keeping existing copies). Replaces the old always-on batch bar.
  const handlePausedTap = useCallback(() => {
    const resumeAll = () =>
      downloadState.inFlightSlugs.forEach((slug) => void resumeDownload(slug))
    const cancelAll = () => {
      // Cancelling reverts episodes to their saved copies (series reads
      // fully-downloaded again) — suppress the false completion toast.
      cancellingRef.current = true
      ;(series?.episodes ?? []).forEach(
        (episode) => void cancelDownload(episode.slug),
      )
    }
    const RESUME = "Resume"
    const CANCEL_ALL = "Cancel all downloads"
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [CANCEL_ALL, RESUME, "Cancel"],
          destructiveButtonIndex: 0,
          cancelButtonIndex: 2,
          userInterfaceStyle: "dark",
        },
        (index) => {
          if (index === 0) cancelAll()
          else if (index === 1) resumeAll()
        },
      )
    } else {
      Alert.alert("Downloads paused", undefined, [
        { text: CANCEL_ALL, style: "destructive", onPress: cancelAll },
        { text: RESUME, onPress: resumeAll },
        { text: "Cancel", style: "cancel" },
      ])
    }
  }, [
    downloadState.inFlightSlugs,
    series?.episodes,
    resumeDownload,
    cancelDownload,
  ])

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
  // Match the loaded hero's dock (top safe edge, full-bleed) so it doesn't jump.
  if (!hasSeries && seed == null && loading) {
    return (
      <View style={layout.screenContainer}>
        <StatusBar style="light" />
        <VideoDetailSkeleton playerTopInset={insets.top} />
        <FloatingBackButton {...BACK_BUTTON_PROPS} />
      </View>
    )
  }

  // No series, no seed, not loading → genuinely nothing to show. screenContainer
  // hosts the absolute back button; the centered error lives in an inner view.
  if (!hasSeries && seed == null) {
    return (
      <View style={layout.screenContainer}>
        <StatusBar style="light" />
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
        <FloatingBackButton {...BACK_BUTTON_PROPS} />
      </View>
    )
  }

  // Hero dock: top safe edge, full-bleed like the /watch player (2026-08-18).
  // Shared by the pinned trailer player and the poster-only hero.
  const heroDock = {
    paddingTop: insets.top,
    // The flush scrubber thumb straddles the trailer's bottom edge; without
    // the lift the later-painted episode grid covers its lower half.
    zIndex: 1,
  }

  // A poster-only hero (no trailer) scrolls away with the list — rendered as the
  // grid header's first element below. A playing trailer stays PINNED here so
  // scrolling never obscures it (the original decoder-safe layout).
  const posterHero = (
    <View
      style={heroDock}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={
        displayTitle ? `${displayTitle} poster` : "Series poster"
      }
    >
      <View style={styles.posterHero}>
        {displayPoster != null && (
          <Image
            source={{ uri: displayPoster }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={series?.documentId ?? decodedSlug}
          />
        )}
      </View>
    </View>
  )

  return (
    <View style={layout.screenContainer}>
      <StatusBar style="light" hidden={isFullscreen} />

      {/* Trailer plays → pin the player at the top so scrolling the list never
          obscures playback. Fullscreen lifts the dock above the grid via zIndex
          (RN zIndex is sibling-scoped, so the player's own can't clear it). */}
      {hasSeries && hasTrailer && (
        <View style={isFullscreen ? styles.heroDockFullscreen : heroDock}>
          <VideoPlayer
            streamingUrl={trailerHls}
            posterUrl={displayPoster}
            fullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            autostart
          />
        </View>
      )}

      <SeriesEpisodesGrid
        episodes={hasSeries ? series.episodes : EMPTY_EPISODES}
        onSelect={handleSelectEpisode}
        badgeBySlug={badgeBySlug}
        header={
          <>
            {!hasTrailer && posterHero}
            <VideoMetadata
              label={series?.label ?? "SERIES"}
              title={displayTitle}
              subtitle={null}
            />

            {hasSeries ? (
              <>
                <SeriesActionRow
                  onLanguage={() => router.push("/series/language")}
                  onSubtitles={() => router.push("/series/subtitle")}
                  // The single download control carries every state: paused →
                  // resume/cancel sheet; downloading → pause; saved → manage
                  // sheet; idle → the download picker. (No separate batch bar.)
                  onDownload={
                    downloadState.pausedAggregate
                      ? handlePausedTap
                      : downloadState.inProgress
                        ? handlePauseAll
                        : seriesFullyDownloaded
                          ? handleManageDownloads
                          : openDownloadSheet
                  }
                  onShare={handleShare}
                  languageLabel={
                    languages.find((l) => l.slug === selectedLanguageSlug)
                      ?.name ?? null
                  }
                  subtitleLabel={subtitleActionLabel}
                  subtitleActive={subtitleActive}
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

      {/* Floating back button overlaid on the hero's top-left corner — replaces
          the native header back. Hidden in fullscreen (the player owns chrome). */}
      {!isFullscreen && <FloatingBackButton {...BACK_BUTTON_PROPS} />}

      <Snackbar
        message={seriesSnackbar ?? ""}
        visible={seriesSnackbar != null}
        onDismiss={() => setSeriesSnackbar(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // Lifts the hero dock (incl. the absolutely-positioned fullscreen player)
  // above the later-painted episodes grid; zIndex is sibling-scoped in RN.
  heroDockFullscreen: {
    zIndex: 1000,
  },
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
