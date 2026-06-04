import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
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
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router"
import { useApolloClient, useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/queries"
import { schedulePersist } from "../../src/lib/cachePersistence"
import type { AdminBlock } from "../../src/lib/queries"
import {
  normalizeVideo,
  type WatchBibleCitation,
} from "../../src/lib/normalizeVideo"
import { decodeWatchSeed } from "../../src/lib/watchSeed"
import { muxHlsUrlFromPlaybackId } from "../../src/lib/muxThumbnail"
import { ACCENT } from "../../src/lib/color"
import { layout, text } from "../../src/styles/shared"
import { VideoPlayer } from "../../src/components/watch/VideoPlayer"
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
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"

const PLAYER_HEIGHT_RATIO = 9 / 16
const EMPTY_CITATIONS: WatchBibleCitation[] = []

export default function WatchVideoPage() {
  const { slug, seed: seedParam } = useLocalSearchParams<{
    slug: string
    seed?: string
  }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const scrollViewRef = useRef<ScrollView>(null)

  const navigation = useNavigation()
  const router = useRouter()
  const [showScrollTop, setShowScrollTop] = useState(false)
  const scrollTopOpacity = useRef(new Animated.Value(0)).current
  const titleOpacity = useRef(new Animated.Value(0)).current
  const [showNavTitle, setShowNavTitle] = useState(false)
  const insets = useSafeAreaInsets()

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

  const subtitleVttSrc = useMemo(() => {
    if (!subtitleEnabled || !activeSubtitleSlug || !activeVariantMedia)
      return null
    return (
      activeVariantMedia.subtitles.find(
        (s) => s.languageSlug === activeSubtitleSlug,
      )?.vttSrc ?? null
    )
  }, [subtitleEnabled, activeSubtitleSlug, activeVariantMedia])

  // Prefer the resolved video; fall back to the seed so first paint has
  // content. The player source resolves to the active variant, then the
  // video's first-playable stream, then the seed-derived Mux URL.
  const displayTitle = video?.title ?? seed?.title ?? null
  const displayPoster = video?.posterUrl ?? seed?.imageUrl ?? null
  const playerSource =
    activeVariant?.hls ?? video?.streamingUrl ?? seedStreamingUrl

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = e.nativeEvent.contentOffset.y
      const screenWidth = e.nativeEvent.layoutMeasurement.width
      const playerHeight = screenWidth * PLAYER_HEIGHT_RATIO
      setShowScrollTop(scrollY > playerHeight)
      setShowNavTitle(scrollY > playerHeight + 60)
    },
    [],
  )

  useEffect(() => {
    Animated.timing(scrollTopOpacity, {
      toValue: showScrollTop ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start()
  }, [showScrollTop, scrollTopOpacity])

  useEffect(() => {
    Animated.timing(titleOpacity, {
      toValue: showNavTitle ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start()
  }, [showNavTitle, titleOpacity])

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Animated.Text
          style={[styles.navTitle, { opacity: titleOpacity }]}
          numberOfLines={1}
        >
          {displayTitle ?? ""}
        </Animated.Text>
      ),
    })
  }, [navigation, displayTitle, titleOpacity])

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
  if (!hasVideo && seed == null && loading) {
    return (
      <View style={layout.screenContainer}>
        <VideoDetailSkeleton />
      </View>
    )
  }

  // No video, no seed, not loading → genuinely nothing to show.
  if (!hasVideo && seed == null) {
    return (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>Video Not Found</Text>
        <Text style={text.errorMessage}>
          {error?.message ?? "This video could not be loaded."}
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
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <VideoPlayer
          streamingUrl={playerSource}
          posterUrl={displayPoster}
          subtitleVttSrc={subtitleVttSrc}
          onPlayingChange={undefined}
        />

        <VideoMetadata
          label={video?.label ?? null}
          title={displayTitle}
          subtitle={null}
        />

        {hasVideo ? (
          <>
            <ActionButtonRow
              onDownload={() => router.push("/watch/download")}
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
                >
                  Retry
                </Text>
              </View>
            )}
            <VideoDetailSkeleton variant="sections" />
          </>
        )}
      </ScrollView>

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
            <Ionicons name="chevron-up" size={22} color="#f5f5f4" />
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
  scrollContent: {
    paddingBottom: 80,
  },
  navTitle: {
    color: "#f5f5f4",
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "System",
    textAlign: "center",
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
    color: ACCENT,
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
    backgroundColor: "rgba(41, 37, 36, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
})
