import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Alert,
  Animated,
  AppState,
  BackHandler,
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
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router"
import { useApolloClient, useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/queries"
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
import {
  enterFullscreenLandscape,
  exitToPortrait,
} from "../../src/lib/orientation"
import { VideoDetailSkeleton } from "../../src/components/watch/VideoDetailSkeleton"
import { VideoMetadata } from "../../src/components/watch/VideoMetadata"
import { ActionButtonRow } from "../../src/components/watch/ActionButtonRow"
import { UpNextCarousel } from "../../src/components/watch/UpNextCarousel"
import { VideoDescription } from "../../src/components/watch/VideoDescription"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { RelatedQuestionsRenderer } from "../../src/components/sections/RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "../../src/components/sections/BibleQuotesCarouselRenderer"
import { useBibleVerses } from "../../src/hooks/useBibleVerses"
import { Snackbar } from "../../src/components/ui/Snackbar"
import { FloatingBackButton } from "../../src/components/ui/FloatingBackButton"
import { PLAYER_HEIGHT_RATIO } from "../../src/lib/playerLayout"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { validateLocalMediaUrl } from "../../src/lib/validateLocalMediaUrl"
import { OFFLINE_ROOT } from "../../src/lib/offlineFileSystem"
import { buildSubtitlePath } from "../../src/lib/offlineFiles"

const EMPTY_CITATIONS: WatchBibleCitation[] = []
// Inline player is inset this far on each side; the back button floats just
// inside the player's top-left corner (the side padding + an inner margin).
const PLAYER_SIDE_PADDING = 10
const BACK_BUTTON_PROPS = {
  topOffset: 10,
  sideOffset: PLAYER_SIDE_PADDING + 8,
}

export default function WatchVideoPage() {
  const { slug, seed: seedParam } = useLocalSearchParams<{
    slug: string
    seed?: string
  }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const scrollViewRef = useRef<ScrollView>(null)

  const navigation = useNavigation()
  const router = useRouter()
  const {
    getRecord,
    deleteDownload,
    committedFor,
    isReady: downloadsReady,
  } = useDownloads()
  const [showScrollTop, setShowScrollTop] = useState(false)
  const scrollTopOpacity = useRef(new Animated.Value(0)).current
  const [isFullscreen, setIsFullscreen] = useState(false)
  const insets = useSafeAreaInsets()
  // Honor reduce-motion for the scroll-to-top FAB, the way the player's
  // chrome/subtitles already do — snap instead of fading.
  const reduceMotionRef = useRef(false)

  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), [])

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

  // Fullscreen side-effects: disable the iOS edge-swipe back (so it can't pop
  // the route mid-fullscreen) and drive orientation. The native header stays
  // hidden in both states (see app/watch/_layout.tsx) — the floating back
  // button is the inline back affordance.
  //
  // Orientation is driven TWO ways because react-native-screens (which
  // expo-router's native Stack uses) owns the view controller's
  // supportedInterfaceOrientations and overrides expo-screen-orientation's
  // lockAsync. Setting the screen's `orientation` option is what actually
  // rotates the view; the expo-screen-orientation calls re-assert the lock and
  // cover the global/non-screen paths.
  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: !isFullscreen,
      orientation: isFullscreen ? "landscape" : "portrait",
    })
    if (isFullscreen) void enterFullscreenLandscape()
    else void exitToPortrait()
  }, [isFullscreen, navigation])

  // While fullscreen: Android hardware back exits fullscreen (not the route),
  // and a foreground resume re-asserts the landscape-follow lock the OS may
  // have dropped on background.
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

  // Safety net: re-lock portrait if the screen unmounts while still fullscreen
  // (e.g. a deep navigation away), so no other screen inherits landscape.
  useEffect(() => {
    return () => {
      void exitToPortrait()
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
    snackbarMessage,
    setSnackbarMessage,
  } = useWatchSession()

  const apolloClient = useApolloClient()
  const { data, loading, error, refetch } = useQuery(GET_VIDEO_BY_SLUG, {
    variables: { slug: decodedSlug, locale: "en" },
    skip: !decodedSlug,
    // cache-first, NOT cache-and-network: this payload is huge for videos with
    // many dubs (e.g. birth-of-jesus is ~9.5MB / 2,259 dubs). cache-and-network
    // refetched and re-parsed all of it on every (re-)entry, then re-ran
    // normalizeVideo over every dub on the JS thread — freezing the whole screen
    // (player, buttons, expanders all dead). cache-first reads the warm cache on
    // re-entry with no refetch. First cold load still fetches once.
    // NOTE: if cache persistence (U7) is enabled, revisit this — a restored
    // snapshot strips volatile URLs, so cache-first must be paired with a
    // cold-start revalidation there.
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

  // A series reached via /watch (deep link, recommendation, or a stale search
  // entry) redirects to the dedicated series page. Detection is label-based —
  // the lean watch fragment doesn't fetch the video's own children. Fires once
  // per resolved slug (a ref guard) so it can't loop, and as early as the record
  // resolves to minimize the brief watch-screen flash (the seed's playbackId is
  // null for a series, so no stream loads in that window).
  const redirectedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!normalized) return
    if (redirectedRef.current === decodedSlug) return
    if (!isSeriesRecord(normalized)) return
    redirectedRef.current = decodedSlug
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

  // Publish the fetched video into the shared session so the sheet routes can
  // read variants/subtitles without refetching. Keyed on the normalized object
  // so partial → full enrichment (returnPartialData) republishes; the session
  // guards against resetting user selections across these republishes.
  useEffect(() => {
    if (normalized) {
      setVideo(normalized)
      // Persist after a video the user is likely to revisit lands (no-op unless
      // cache persistence is enabled).
      schedulePersist(apolloClient)
    }
  }, [normalized, setVideo, apolloClient])

  // Navigated to a different video that hasn't loaded yet (e.g. Up Next): drop
  // the previous video from the session so the loading guard shows the spinner
  // instead of the prior video's content, and the sheets don't read its stale
  // variants. The publish effect above repopulates once the new data arrives.
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
    // Offline playback shows only the locally-saved subtitle (read from disk).
    if (offlineSource) return offlineSubtitle
    if (!subtitleEnabled || !activeSubtitleSlug || !activeVariantMedia)
      return null
    return (
      activeVariantMedia.subtitles.find(
        (s) => s.languageSlug === activeSubtitleSlug,
      )?.vttSrc ?? null
    )
  }, [
    offlineSource,
    offlineSubtitle,
    subtitleEnabled,
    activeSubtitleSlug,
    activeVariantMedia,
  ])

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

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = e.nativeEvent.contentOffset.y
      const screenWidth = e.nativeEvent.layoutMeasurement.width
      // The inline player is inset PLAYER_SIDE_PADDING per side, so its real
      // 16:9 height is shorter than the full screen width would imply.
      const playerHeight =
        (screenWidth - PLAYER_SIDE_PADDING * 2) * PLAYER_HEIGHT_RATIO
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
    const langSlug = activeVariant?.languageSlug
    const base = `https://www.jesusfilm.org/watch/${video.slug}`
    const shareUrl = langSlug ? `${base}/${langSlug}` : base
    Share.share({ message: shareUrl, title: video.title ?? undefined })
  }, [video, activeVariant?.languageSlug])

  const hasVideo = video != null

  // Cold deep link with nothing to paint yet → layout-matched skeleton,
  // never a blank full-screen spinner.
  if (!hasVideo && seed == null && loading && !offlineSource) {
    return (
      <View style={layout.screenContainer}>
        <StatusBar style="light" />
        {/* Match the loaded player's dock (top safe edge + side inset) so the
            player block doesn't jump when canonical data lands. */}
        <VideoDetailSkeleton
          playerTopInset={insets.top}
          playerHorizontalInset={PLAYER_SIDE_PADDING}
        />
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

      {/* Player is pinned at the route root (outside the ScrollView) so its
          custom fullscreen can expand to an absolute-fill window overlay above
          the page, without ever being reparented (which would release the
          expo-video player). Inline it sits at the top safe edge, inset by
          PLAYER_SIDE_PADDING per side; content scrolls beneath it. The dock
          padding is dropped in fullscreen, where the player goes absolute. */}
      <View
        style={
          isFullscreen
            ? // zIndex lifts the whole dock subtree (incl. the absolutely-
              // positioned fullscreen player) above the ScrollView — RN zIndex
              // is sibling-scoped, so the player's own zIndex can't escape this
              // wrapper to clear the later-painted ScrollView on its own.
              styles.playerDockFullscreen
            : {
                paddingTop: insets.top,
                paddingHorizontal: PLAYER_SIDE_PADDING,
              }
        }
      >
        <VideoPlayer
          streamingUrl={playerSource}
          posterUrl={displayPoster}
          subtitleVttSrc={subtitleVttSrc}
          onPlayingChange={undefined}
          fullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          horizontalInset={PLAYER_SIDE_PADDING}
        />
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
                } else if (state && state !== "canceled") {
                  // A transfer is in flight (one copy per video). Offer to remove.
                  Alert.alert(
                    "Offline download",
                    "This video is downloading.",
                    [
                      {
                        text: "Remove download",
                        style: "destructive",
                        onPress: () => {
                          void deleteDownload(video.slug)
                        },
                      },
                      { text: "Keep", style: "cancel" },
                    ],
                  )
                } else {
                  router.push("/watch/download")
                }
              }}
              onLanguage={() => router.push("/watch/language")}
              onSubtitles={() => router.push("/watch/subtitle")}
              onShare={handleShare}
            />

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
        message={snackbarMessage ?? "Download complete"}
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
