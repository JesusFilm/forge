import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Alert,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { StatusBar } from "expo-status-bar"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useApolloClient, useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/queries"
import { datadogLog } from "../../src/lib/datadog"
import {
  consumeDeepLinkEntry,
  whenDeepLinkOriginsReady,
} from "../../src/lib/deepLinkOrigin"
import { schedulePersist } from "../../src/lib/cachePersistence"
import type { AdminBlock } from "../../src/lib/queries"
import {
  normalizeVideo,
  type WatchBibleCitation,
} from "../../src/lib/normalizeVideo"
import { isSeriesRecord } from "../../src/lib/isSeriesRecord"
import { decodeWatchSeed } from "../../src/lib/watchSeed"
import { muxHlsUrlFromPlaybackId } from "../../src/lib/muxThumbnail"
import {
  ACCENT_ON_DARK,
  BLACK,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  hexToRgba,
} from "../../src/lib/color"
import { layout, text } from "../../src/styles/shared"
import { VideoPlayer } from "../../src/components/watch/VideoPlayer"
import { useCastPlayback } from "../../src/hooks/useCastPlayback"
import { useCastProgressRecording } from "../../src/hooks/useCastProgressRecording"
import type { ProgressFeed } from "../../src/hooks/useManagedVideoPlayer"
import { showCastDialog } from "../../src/lib/cast/castAdapter"
import {
  resolveCastMedia,
  type CastMedia,
} from "../../src/lib/cast/castMediaResolver"
import {
  isRemoteCastPhase,
  isRemotePlayingState,
  releaseTriggersSwap,
  type CastRecovery,
} from "../../src/lib/playbackTarget"
import { useFullscreenPresentation } from "../../src/hooks/useFullscreenPresentation"
import { buildWatchShareUrl } from "../../src/lib/watchShareUrl"
import { VideoDetailSkeleton } from "../../src/components/watch/VideoDetailSkeleton"
import { PlayerPoster } from "../../src/components/watch/PlayerPoster"
import { WatchAmbient } from "../../src/components/watch/WatchAmbient"
import { VideoMetadata } from "../../src/components/watch/VideoMetadata"
import { ActionButtonRow } from "../../src/components/watch/ActionButtonRow"
import { SignInPrompt } from "../../src/components/watch/SignInPrompt"
import { useWatchProgressEntry } from "../../src/hooks/useWatchProgressEntry"
import {
  progressBarState,
  resumePositionSeconds,
} from "../../src/lib/watchProgress/thresholds"
import { UpNextCarousel } from "../../src/components/watch/UpNextCarousel"
import { VideoDescription } from "../../src/components/watch/VideoDescription"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { RelatedQuestionsRenderer } from "../../src/components/sections/RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "../../src/components/sections/BibleQuotesCarouselRenderer"
import { useBibleVerses } from "../../src/hooks/useBibleVerses"
import { Snackbar } from "../../src/components/ui/Snackbar"
import { FloatingBackButton } from "../../src/components/ui/FloatingBackButton"
import {
  BACK_BUTTON_PROPS,
  PLAYER_HEIGHT_RATIO,
} from "../../src/lib/playerLayout"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { validateLocalMediaUrl } from "../../src/lib/validateLocalMediaUrl"
import { OFFLINE_ROOT } from "../../src/lib/offlineFileSystem"
import { buildSubtitlePath } from "../../src/lib/offlineFiles"
import {
  resolveActiveSubtitle,
  resolveSubtitleActionLabel,
} from "../../src/lib/subtitleSelection"

const EMPTY_CITATIONS: WatchBibleCitation[] = []

export default function WatchVideoPage() {
  const { slug, seed: seedParam } = useLocalSearchParams<{
    slug: string
    seed?: string
  }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const scrollViewRef = useRef<ScrollView>(null)

  const router = useRouter()
  const {
    getRecord,
    deleteDownload,
    pauseDownload,
    resumeDownload,
    committedFor,
    isReady: downloadsReady,
  } = useDownloads()
  const [showScrollTop, setShowScrollTop] = useState(false)
  const scrollTopOpacity = useRef(new Animated.Value(0)).current
  const { isFullscreen, toggleFullscreen } = useFullscreenPresentation()
  const insets = useSafeAreaInsets()
  // Honor reduce-motion for the scroll-to-top FAB, the way the player's
  // chrome/subtitles already do — snap instead of fading.
  const reduceMotionRef = useRef(false)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduceMotionRef.current = v
    })
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => {
        reduceMotionRef.current = v
      },
    )
    return () => {
      try {
        sub.remove()
      } catch {
        // noop
      }
    }
  }, [])

  const {
    video,
    setVideo,
    activeVariant,
    activeVariantMedia,
    ensureActiveVariantMedia,
    subtitleEnabled,
    activeSubtitleSlug,
    preferredSubtitleName,
    snackbarMessage,
    setSnackbarMessage,
  } = useWatchSession()

  const apolloClient = useApolloClient()
  const { data, loading, error, refetch } = useQuery(GET_VIDEO_BY_SLUG, {
    variables: { slug: decodedSlug, locale: "en" },
    skip: !decodedSlug,
    // cache-first, NOT cache-and-network: payload is huge (~9.5MB / 2,259 dubs)
    // and cache-and-network re-parsed it per re-entry, freezing JS. NOTE: if cache
    // persistence (U7) lands, revisit — restored snapshots need cold-start revalidation.
    fetchPolicy: "cache-first",
    // Render whatever the cache holds (prefetch) the moment it exists.
    returnPartialData: true,
  })

  const normalized = useMemo(
    // returnPartialData widens videoBySlug to a deep-partial type; normalizeVideo
    // is written to tolerate missing fields (returns null without a documentId),
    // so treat the partial as the raw shape it guards internally.
    () =>
      normalizeVideo(
        (data?.videoBySlug ?? null) as Parameters<typeof normalizeVideo>[0],
      ),
    [data],
  )

  // A series reached via /watch redirects to the series page. Detection is
  // label-based (lean fragment doesn't fetch children). Ref-guarded to once per
  // slug (can't loop), as early as the record resolves to minimize the flash.
  const redirectedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!normalized) return
    if (redirectedRef.current === decodedSlug) return
    if (!isSeriesRecord(normalized)) return
    redirectedRef.current = decodedSlug
    datadogLog.info("content.resolution", {
      outcome: "series-redirect",
      content_id: decodedSlug,
    })
    const seedSuffix = seedParam ? `?seed=${seedParam}` : ""
    router.replace(`/series/${encodeURIComponent(decodedSlug)}${seedSuffix}`)
  }, [normalized, decodedSlug, seedParam, router])

  // Seed carried from the list surface (search / Up Next) so the screen paints
  // instantly from data already in hand, before the query resolves.
  const seed = useMemo(() => decodeWatchSeed(seedParam), [seedParam])
  const seedStreamingUrl = useMemo(
    () => muxHlsUrlFromPlaybackId(seed?.playbackId ?? null),
    [seed],
  )

  // Publish video into the shared session so sheet routes read variants/subtitles
  // without refetching. Keyed on the normalized object so partial→full enrichment
  // republishes; the session guards user selections across republishes.
  useEffect(() => {
    if (normalized) {
      setVideo(normalized)
      // Persist after a video the user is likely to revisit lands (no-op unless
      // cache persistence is enabled).
      schedulePersist(apolloClient)
    }
  }, [normalized, setVideo, apolloClient])

  // Navigated to a not-yet-loaded video (e.g. Up Next): drop the previous video
  // so the loading guard shows the spinner (not stale content/variants). The
  // publish effect above repopulates once the new data arrives.
  useEffect(() => {
    if (video && video.slug !== decodedSlug && !normalized) {
      setVideo(null)
    }
  }, [decodedSlug, video, normalized, setVideo])

  const bibleQuotes = useBibleVerses(video?.bibleCitations ?? EMPTY_CITATIONS)

  // Captions on (possibly carried over a language switch) → make sure the
  // active dub's subtitles are fetched so the player has a track to show.
  useEffect(() => {
    if (subtitleEnabled) ensureActiveVariantMedia()
  }, [subtitleEnabled, ensureActiveVariantMedia])

  // Offline: when a committed local copy exists (manifest hydrated), play it
  // from disk ahead of the GraphQL source chain. The local URI is validated
  // against the offline root before it reaches the player / subtitle reader.
  const offlineRecord = downloadsReady ? getRecord(decodedSlug) : null
  const offlineCommitted = downloadsReady ? committedFor(decodedSlug) : null
  const offlineSource =
    offlineCommitted && validateLocalMediaUrl(offlineCommitted, OFFLINE_ROOT)
      ? offlineCommitted
      : null
  const offlineSubtitle =
    offlineSource && offlineRecord?.subtitleLanguageSlug
      ? (() => {
          const path = buildSubtitlePath(
            OFFLINE_ROOT,
            decodedSlug,
            offlineRecord.subtitleLanguageSlug,
          )
          return validateLocalMediaUrl(path, OFFLINE_ROOT) ? path : null
        })()
      : null

  const subtitleVttSrc = useMemo(() => {
    // Offline playback reads the locally-saved subtitle from disk, but still
    // honors the subtitles toggle: the track is always bundled at download
    // time, yet only shown when captions are on — matching online playback.
    if (offlineSource) return subtitleEnabled ? offlineSubtitle : null
    if (!subtitleEnabled || !activeSubtitleSlug || !activeVariantMedia)
      return null
    return (
      resolveActiveSubtitle(activeSubtitleSlug, activeVariantMedia.subtitles)
        ?.vttSrc ?? null
    )
  }, [
    offlineSource,
    offlineSubtitle,
    subtitleEnabled,
    activeSubtitleSlug,
    activeVariantMedia,
  ])

  // Action-button labels surface the current selection. The subtitle label is
  // "Off"/the active name, falling back to the persisted preferred name while the
  // lazy media loads — so a cold load paints it, not a "Subtitles" placeholder.
  const languageActionLabel = activeVariant?.languageName ?? null

  // Continue watching (KTD6): resume eligibility for the player's
  // auto-seek and autostart.
  const progressEntry = useWatchProgressEntry(video?.documentId)
  const progressState = progressBarState(progressEntry)
  const resumeAtSeconds =
    progressEntry && progressState.resumeEligible
      ? resumePositionSeconds(
          progressEntry.positionSeconds,
          progressEntry.durationSeconds,
        )
      : null
  const subtitleActionLabel = resolveSubtitleActionLabel(
    subtitleEnabled,
    activeSubtitleSlug,
    activeVariantMedia?.subtitles ?? null,
    preferredSubtitleName,
  )
  // A loaded dub with no tracks reads as "Off" — mute the pill too, so an enabled
  // preference carried from another video doesn't paint as active here.
  const subtitlesAvailable =
    activeVariantMedia == null || activeVariantMedia.subtitles.length > 0
  const subtitleActive = subtitleEnabled && subtitlesAvailable

  // Prefer the resolved video; fall back to the seed so first paint has
  // content. The player source resolves to the active variant, then the
  // video's first-playable stream, then the seed-derived Mux URL.
  const displayTitle = video?.title ?? seed?.title ?? null
  const displayPoster = video?.posterUrl ?? seed?.imageUrl ?? null
  const playerSource =
    offlineSource ??
    activeVariant?.hls ??
    video?.streamingUrl ??
    seedStreamingUrl

  // ---- Cast session lifecycle (U4: KTD4/KTD7) ----
  // The hook owns the KTD7 end triggers (slug change + unmount) internally.
  const cast = useCastPlayback({ videoSlug: decodedSlug || null })
  const castSessionState = cast.state
  const castRemoteActive = isRemoteCastPhase(castSessionState.phase)

  // Caller-side source freeze (KTD4): pin the player's source to the
  // pre-session URL, so a dub chosen mid-session replays through the
  // existing swap machinery when the pin releases at session end.
  const pinnedCastSourceRef = useRef<string | null>(null)
  const releasedCastSourceRef = useRef<string | null>(null)
  if (castRemoteActive) {
    if (pinnedCastSourceRef.current == null) {
      pinnedCastSourceRef.current = playerSource
    }
  } else if (pinnedCastSourceRef.current != null) {
    releasedCastSourceRef.current = pinnedCastSourceRef.current
    pinnedCastSourceRef.current = null
  }
  const effectivePlayerSource = castRemoteActive
    ? pinnedCastSourceRef.current
    : playerSource

  // KTD5: the resolver input is this screen's source chain MINUS the
  // offlineSource prefix — a receiver can only fetch remote https.
  // U5: the last load's start position seeds the load-time progress tick
  // before the receiver's first position report.
  const castLoadStartRef = useRef<number | null>(null)
  const resolveCastMediaAt = useCallback(
    (startPositionSeconds: number | null): CastMedia | null => {
      const media = resolveCastMedia({
        activeVariant,
        video,
        seedStreamingUrl,
        title: displayTitle,
        posterUrl: displayPoster,
        startPositionSeconds,
      })
      if (media != null) castLoadStartRef.current = media.startPositionSeconds
      return media
    },
    [activeVariant, video, seedStreamingUrl, displayTitle, displayPoster],
  )

  const handleCastPress = useCallback(() => {
    // The SDK dialog also carries "Stop casting" during a session (R10).
    void showCastDialog().catch(() => {})
  }, [])

  // Last known remote position and play state: the Failed state carries
  // neither, and Ended's position can be null if the client tore down first.
  const lastCastPositionRef = useRef<number | null>(null)
  const lastRemotePlayingRef = useRef(false)
  useEffect(() => {
    if (castSessionState.phase === "connecting") {
      lastCastPositionRef.current = null
      lastRemotePlayingRef.current = false
    }
  }, [castSessionState.phase])
  useEffect(() => {
    if (cast.position != null) lastCastPositionRef.current = cast.position
  }, [cast.position])
  useEffect(() => {
    if (cast.remotePlayerState != null) {
      lastRemotePlayingRef.current = isRemotePlayingState(
        cast.remotePlayerState,
      )
    }
  }, [cast.remotePlayerState])

  // U5 (KTD6/R11): cast positions feed the watch-progress recorder through
  // the adapter's ref-stable facade (filled in by VideoPlayer). Registered
  // BEFORE the epilogue below so terminal flushes land before reset().
  const progressFeedRef = useRef<ProgressFeed | null>(null)
  useCastProgressRecording({
    state: castSessionState,
    position: cast.position,
    duration: cast.duration,
    feedRef: progressFeedRef,
    getLoadStartPosition: () => castLoadStartRef.current,
  })

  // Derived in the SAME render as the terminal state: child (VideoPlayer)
  // effects run before this screen's, so the recovery is latched before the
  // reset below clears the terminal state.
  const castRecovery = useMemo<CastRecovery | null>(() => {
    if (castSessionState.phase === "ended") {
      // videoChanged/unmount: the player belongs to another video (KTD7) —
      // no seek may land on it.
      if (castSessionState.trigger !== "userEnd") return null
      return {
        positionSeconds:
          castSessionState.lastPositionSeconds ?? lastCastPositionRef.current,
        resume: lastRemotePlayingRef.current,
        sourceSwapped: releaseTriggersSwap(
          releasedCastSourceRef.current,
          playerSource,
        ),
      }
    }
    if (castSessionState.phase === "failed") {
      return {
        positionSeconds: lastCastPositionRef.current,
        resume: lastRemotePlayingRef.current,
        sourceSwapped: releaseTriggersSwap(
          releasedCastSourceRef.current,
          playerSource,
        ),
      }
    }
    return null
  }, [castSessionState, playerSource])

  // R13/R10 epilogue: snackbar on failure, then return the reducer to Idle.
  const castReset = cast.reset
  useEffect(() => {
    if (castSessionState.phase === "failed") {
      setSnackbarMessage("Casting failed. Playback continues on your phone.")
      castReset()
    } else if (castSessionState.phase === "ended") {
      castReset()
    }
  }, [castSessionState, castReset, setSnackbarMessage])

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = e.nativeEvent.contentOffset.y
      const screenWidth = e.nativeEvent.layoutMeasurement.width
      // The inline player is full-bleed, so its 16:9 height comes from the
      // whole measured width.
      const playerHeight = screenWidth * PLAYER_HEIGHT_RATIO
      setShowScrollTop(scrollY > playerHeight)
    },
    [],
  )

  useEffect(() => {
    const to = showScrollTop ? 1 : 0
    if (reduceMotionRef.current) {
      scrollTopOpacity.setValue(to)
      return
    }
    Animated.timing(scrollTopOpacity, {
      toValue: to,
      duration: 200,
      useNativeDriver: true,
    }).start()
  }, [showScrollTop, scrollTopOpacity])

  const handleScrollToTop = useCallback(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true })
  }, [])

  const handleShare = useCallback(() => {
    if (!video) return
    // Share.share rejects when the OS share sheet is dismissed/unavailable;
    // swallow it so it never surfaces as an unhandled rejection.
    void Share.share({
      message: buildWatchShareUrl(video.slug, activeVariant?.languageSlug),
      title: video.title ?? undefined,
    }).catch(() => {})
  }, [video, activeVariant?.languageSlug])

  const hasVideo = video != null

  // Slug-keyed, NOT a boolean: expo-router reuses this route object for a
  // same-name NAVIGATE, which is what a warm deep link dispatches, so a boolean
  // would swallow the second slug's event.
  const deepLinkEmittedRef = useRef<Set<string>>(new Set())

  // External arrivals only. "No seed" over-counts (Library opens rows unseeded)
  // and stack shape under-counts (the tabs anchor makes canGoBack() always
  // true), so this awaits the registry that records the opening URL.
  useEffect(() => {
    if (!decodedSlug || deepLinkEmittedRef.current.has(decodedSlug)) return
    let cancelled = false
    void whenDeepLinkOriginsReady().then(() => {
      if (cancelled || deepLinkEmittedRef.current.has(decodedSlug)) return
      const entry = consumeDeepLinkEntry(decodedSlug)
      if (entry == null) return
      deepLinkEmittedRef.current.add(decodedSlug)
      datadogLog.info("content.deep_link_open", {
        content_id: decodedSlug,
        entry,
      })
    })
    return () => {
      cancelled = true
    }
  }, [decodedSlug])

  // A half-rendered page ("Couldn't load full details") used to reach Datadog
  // only as an abort-shaped network warn, indistinguishable from a healthy one.
  // Deduped per slug so Retry loops can't flood.
  const detailFailureEmittedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (hasVideo || error == null || !decodedSlug) return
    if (detailFailureEmittedRef.current.has(decodedSlug)) return
    detailFailureEmittedRef.current.add(decodedSlug)
    datadogLog.warn("content.detail_load_failed", {
      content_id: decodedSlug,
      // Seeded => partial page with a Retry; unseeded => the "Video Not Found" screen.
      surface: seed != null || offlineSource != null ? "partial" : "empty",
    })
  }, [hasVideo, error, decodedSlug, seed, offlineSource])

  // Detail-route resolution outcome (R34), deduped per slug+outcome so a
  // re-render or a skeleton→hydrated transition each emit at most once. Series
  // are owned by the redirect effect above.
  const resolutionEmittedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (normalized && isSeriesRecord(normalized)) return
    const outcome =
      offlineSource != null
        ? "offline-source"
        : hasVideo
          ? "hydrated"
          : seed != null
            ? "seed-only"
            : loading
              ? "cold-skeleton"
              : "not-found"
    const key = `${decodedSlug}:${outcome}`
    if (resolutionEmittedRef.current.has(key)) return
    resolutionEmittedRef.current.add(key)
    datadogLog.info("content.resolution", { outcome, content_id: decodedSlug })
  }, [decodedSlug, normalized, offlineSource, hasVideo, seed, loading])

  // A seed with no playbackId can't source a stream (series/collection, or no
  // variant in the target language), so painting 0:00/0:00 player chrome for it
  // would be a lie. Hold the layout-matched skeleton instead.
  // The redirect above runs in an effect, so the record resolving would
  // otherwise paint one frame of this screen before we leave. Hold the skeleton.
  const seriesRedirectPending = normalized != null && isSeriesRecord(normalized)
  if (
    seriesRedirectPending ||
    (!hasVideo && seed == null && loading && !offlineSource)
  ) {
    return (
      <View style={layout.screenContainer}>
        <StatusBar style="light" />
        {/* Match the loaded player's dock (top safe edge, full-bleed sides) so
            the player block doesn't jump when canonical data lands. */}
        <VideoDetailSkeleton playerTopInset={insets.top} />
        <FloatingBackButton {...BACK_BUTTON_PROPS} />
      </View>
    )
  }

  // No video, no seed, not loading → genuinely nothing to show.
  if (!hasVideo && seed == null && !offlineSource) {
    return (
      // screenContainer (no horizontal padding) hosts the absolute back button
      // so it aligns with the loading/loaded states; the centered error content
      // lives in an inner view that owns the padding.
      <View style={layout.screenContainer}>
        <StatusBar style="light" />
        <View style={layout.centered}>
          <Text style={text.errorTitle}>Video Not Found</Text>
          <Text style={text.errorMessage}>
            {error?.message ?? "This video could not be loaded."}
          </Text>
          <Text
            style={styles.retryLink}
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading video"
          >
            Retry
          </Text>
        </View>
        <FloatingBackButton {...BACK_BUTTON_PROPS} />
      </View>
    )
  }

  const studyQuestionsBlock: AdminBlock | null =
    hasVideo && video.studyQuestions.length > 0
      ? {
          __typename: "RelatedQuestionsBlock",
          heading: "Study Questions",
          questions: video.studyQuestions.map((q) => ({
            question: q.value,
            answer: "",
          })),
          ctaLabel: null,
          ctaLink: null,
        }
      : null

  const bibleCitationsBlock: AdminBlock | null =
    hasVideo && video.bibleCitations.length > 0
      ? {
          __typename: "BibleQuotesCarouselBlock",
          heading: "Bible Quotes",
          quotes: bibleQuotes,
        }
      : null

  return (
    <View style={layout.screenContainer}>
      <StatusBar style="light" hidden={isFullscreen} />

      {/* Sibling of the player dock, NOT a child: the dock carries
          paddingTop, which an absolutely-positioned child would be inset by,
          missing the safe-area strip this exists to paint. */}
      {!isFullscreen && (
        <WatchAmbient posterUrl={displayPoster} topInset={insets.top} />
      )}

      {/* Player pinned at route root (outside ScrollView) so its fullscreen can
          expand to an absolute-fill overlay without reparenting (which would
          release the expo-video player). Inline: top safe edge, full-bleed. */}
      <View
        style={
          isFullscreen
            ? // zIndex lifts the whole dock subtree (incl. the absolutely-
              // positioned fullscreen player) above the ScrollView — RN zIndex
              // is sibling-scoped, so the player's own zIndex can't escape this
              // wrapper to clear the later-painted ScrollView on its own.
              styles.playerDockFullscreen
            : // Inline needs a small lift too: the flush scrubber thumb
              // straddles the player's bottom edge (Scrubber flush contract),
              // and the later-painted ScrollView would cover its lower half.
              [styles.playerDockInline, { paddingTop: insets.top }]
        }
      >
        {playerSource == null ? (
          // No stream yet (series/collection pre-redirect, or no variant in the
          // target language). Paint the artwork, not transport chrome for
          // something unplayable.
          <PlayerPoster
            posterUrl={displayPoster}
            // Spin only while the stream is still being resolved — once the
            // query settles, a null source means unplayable, not pending.
            loading={loading && error == null}
          />
        ) : (
          <VideoPlayer
            streamingUrl={effectivePlayerSource}
            posterUrl={displayPoster}
            subtitleVttSrc={subtitleVttSrc}
            onPlayingChange={undefined}
            fullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            cast={{
              playback: cast,
              onCastPress: handleCastPress,
              resolveMediaAt: resolveCastMediaAt,
              recovery: castRecovery,
              progressFeedRef,
            }}
            progressIdentity={
              // Offline playback may predate the record load — the slug is
              // the on-device key admin resolves server-side (KTD8).
              video?.documentId
                ? {
                    videoId: video.documentId,
                    languageSlug: activeVariant?.languageSlug ?? null,
                  }
                : offlineSource
                  ? { videoSlug: decodedSlug, languageSlug: null }
                  : null
            }
            resumeAtSeconds={resumeAtSeconds}
            autostart
          />
        )}
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <VideoMetadata
          label={video?.label ?? null}
          title={displayTitle}
          subtitle={null}
        />

        {hasVideo ? (
          <>
            <ActionButtonRow
              downloadState={getRecord(video.slug)?.state ?? null}
              downloadProgress={(() => {
                const record = getRecord(video.slug)
                return record && record.totalBytes > 0
                  ? record.bytesWritten / record.totalBytes
                  : null
              })()}
              onDownload={() => {
                const state = getRecord(video.slug)?.state
                if (state === "downloaded") {
                  // Saved: offer a non-destructive quality/language swap or a
                  // delete (the current copy stays playable during a swap).
                  Alert.alert(
                    "Offline download",
                    "This video is saved for offline viewing.",
                    [
                      {
                        text: "Change quality / language",
                        onPress: () => router.push("/watch/download?swap=1"),
                      },
                      {
                        text: "Remove download",
                        style: "destructive",
                        onPress: () => {
                          void deleteDownload(video.slug)
                        },
                      },
                      { text: "Cancel", style: "cancel" },
                    ],
                  )
                } else if (state === "paused") {
                  // Paused (mirrors the series ring): resume, or remove entirely.
                  Alert.alert("Offline download", "This download is paused.", [
                    {
                      text: "Remove download",
                      style: "destructive",
                      onPress: () => {
                        void deleteDownload(video.slug)
                      },
                    },
                    {
                      text: "Resume",
                      onPress: () => void resumeDownload(video.slug),
                    },
                    { text: "Cancel", style: "cancel" },
                  ])
                } else if (state === "downloading") {
                  // In flight → the ring's pause glyph pauses it immediately.
                  void pauseDownload(video.slug)
                } else if (state === "queued") {
                  // Queued in a series batch — no live transfer to pause yet, so
                  // offer to remove it from the download.
                  Alert.alert("Offline download", "This download is queued.", [
                    {
                      text: "Remove download",
                      style: "destructive",
                      onPress: () => {
                        void deleteDownload(video.slug)
                      },
                    },
                    { text: "Cancel", style: "cancel" },
                  ])
                } else {
                  // Idle / failed / canceled → the download picker (retry included).
                  router.push("/watch/download")
                }
              }}
              onLanguage={() => router.push("/watch/language")}
              onSubtitles={() => router.push("/watch/subtitle")}
              onShare={handleShare}
              languageLabel={languageActionLabel}
              subtitleLabel={subtitleActionLabel}
              subtitleActive={subtitleActive}
            />

            <SignInPrompt />

            <VideoDescription description={video.description} />

            {video.siblings.length > 0 && (
              <View style={styles.sectionGap}>
                <UpNextCarousel
                  siblings={video.siblings}
                  currentSlug={video.slug}
                />
              </View>
            )}

            {studyQuestionsBlock != null && (
              <View style={styles.sectionGap}>
                <RelatedQuestionsRenderer section={studyQuestionsBlock} />
              </View>
            )}

            {bibleCitationsBlock != null && (
              <View style={styles.sectionGap}>
                <BibleQuotesCarouselRenderer section={bibleCitationsBlock} />
              </View>
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
                  accessibilityLabel="Retry loading video details"
                >
                  Retry
                </Text>
              </View>
            )}
            <VideoDetailSkeleton variant="sections" />
          </>
        )}
      </ScrollView>

      {/* Floating back button overlaid on the player's top-right corner —
          replaces the native header back. Hidden in fullscreen (the player owns
          its own chrome there). */}
      {!isFullscreen && <FloatingBackButton {...BACK_BUTTON_PROPS} />}

      {showScrollTop && (
        <Animated.View
          style={[
            styles.scrollTopFab,
            { bottom: insets.bottom + 16, opacity: scrollTopOpacity },
          ]}
        >
          <Pressable
            onPress={handleScrollToTop}
            style={styles.scrollTopButton}
            accessibilityRole="button"
            accessibilityLabel="Scroll to top"
          >
            <Ionicons name="chevron-up" size={22} color={TEXT_PRIMARY} />
          </Pressable>
        </Animated.View>
      )}

      <Snackbar
        message={snackbarMessage ?? ""}
        visible={snackbarMessage != null}
        onDismiss={() => setSnackbarMessage(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  playerDockFullscreen: {
    zIndex: 1000,
  },
  playerDockInline: {
    zIndex: 1,
  },
  scrollContent: {
    paddingBottom: 80,
  },
  sectionGap: {
    marginTop: 16,
  },
  inlineError: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  retryLink: {
    // ACCENT_ON_DARK, not ACCENT: 15px link text needs >= 4.5:1 on the dark bg.
    color: ACCENT_ON_DARK,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 12,
    textAlign: "center",
  },
  scrollTopFab: {
    position: "absolute",
    right: 16,
  },
  scrollTopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: hexToRgba(SURFACE_COLOR, 0.85),
    justifyContent: "center",
    alignItems: "center",
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
})
