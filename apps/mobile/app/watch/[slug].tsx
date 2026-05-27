import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
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
import { useLocalSearchParams, useNavigation } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/queries"
import type { AdminBlock } from "../../src/lib/queries"
import {
  normalizeVideo,
  type WatchBibleCitation,
} from "../../src/lib/normalizeVideo"
import { TEXT_PRIMARY } from "../../src/lib/color"
import { layout, text } from "../../src/styles/shared"
import { VideoPlayer } from "../../src/components/watch/VideoPlayer"
import { VideoMetadata } from "../../src/components/watch/VideoMetadata"
import { ActionButtonRow } from "../../src/components/watch/ActionButtonRow"
import { UpNextCarousel } from "../../src/components/watch/UpNextCarousel"
import { VideoDescription } from "../../src/components/watch/VideoDescription"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { RelatedQuestionsRenderer } from "../../src/components/sections/RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "../../src/components/sections/BibleQuotesCarouselRenderer"
import { useBibleVerses } from "../../src/hooks/useBibleVerses"
import type GorhomBottomSheet from "@gorhom/bottom-sheet"
import { BottomSheet } from "../../src/components/ui/BottomSheet"
import { DownloadSheetContent } from "../../src/components/watch/DownloadSheet"
import { LanguageSheetContent } from "../../src/components/watch/LanguageSheet"
import { SubtitleSheetContent } from "../../src/components/watch/SubtitleSheet"
import { Snackbar } from "../../src/components/ui/Snackbar"

const PLAYER_HEIGHT_RATIO = 9 / 16
const EMPTY_CITATIONS: WatchBibleCitation[] = []

export default function WatchVideoPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const scrollViewRef = useRef<ScrollView>(null)

  const navigation = useNavigation()
  const [showScrollTop, setShowScrollTop] = useState(false)
  const scrollTopOpacity = useRef(new Animated.Value(0)).current
  const titleOpacity = useRef(new Animated.Value(0)).current
  const [showNavTitle, setShowNavTitle] = useState(false)
  const insets = useSafeAreaInsets()
  const downloadSheetRef = useRef<GorhomBottomSheet>(null)
  const [downloadResetKey, setDownloadResetKey] = useState(0)
  const downloadPrevIndex = useRef(-1)
  const languageSheetRef = useRef<GorhomBottomSheet>(null)
  const [languageResetKey, setLanguageResetKey] = useState(0)
  const languagePrevIndex = useRef(-1)
  const subtitleSheetRef = useRef<GorhomBottomSheet>(null)
  const [subtitleResetKey, setSubtitleResetKey] = useState(0)
  const subtitlePrevIndex = useRef(-1)
  const [activeVariantIndex, setActiveVariantIndex] = useState(0)
  const [subtitleEnabled, setSubtitleEnabled] = useState(false)
  const [snackbarVisible, setSnackbarVisible] = useState(false)
  const [activeSubtitleSlug, setActiveSubtitleSlug] = useState<string | null>(
    null,
  )

  const { data, loading, error } = useQuery(GET_VIDEO_BY_SLUG, {
    variables: { slug: decodedSlug, locale: "en" },
    skip: !decodedSlug,
    fetchPolicy: "cache-and-network",
  })

  const video = useMemo(() => normalizeVideo(data?.videoBySlug ?? null), [data])
  const activeVariant = video?.variants[activeVariantIndex] ?? null
  const bibleQuotes = useBibleVerses(video?.bibleCitations ?? EMPTY_CITATIONS)

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
          {video?.title ?? ""}
        </Animated.Text>
      ),
    })
  }, [navigation, video?.title, titleOpacity])

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

  if (loading && !video) {
    return (
      <View style={layout.centered}>
        <ActivityIndicator size="large" color={TEXT_PRIMARY} />
      </View>
    )
  }

  if (error || !video) {
    return (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>Video Not Found</Text>
        <Text style={text.errorMessage}>
          {error?.message ?? "This video could not be loaded."}
        </Text>
      </View>
    )
  }

  const studyQuestionsBlock: AdminBlock | null =
    video.studyQuestions.length > 0
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
    video.bibleCitations.length > 0
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
          streamingUrl={activeVariant?.hls ?? video.streamingUrl}
          posterUrl={video.posterUrl}
          onPlayingChange={undefined}
        />

        <VideoMetadata
          label={video.label}
          title={video.title}
          subtitle={null}
        />

        <ActionButtonRow
          onDownload={() => downloadSheetRef.current?.expand()}
          onLanguage={() => languageSheetRef.current?.snapToIndex(0)}
          onSubtitles={() => subtitleSheetRef.current?.snapToIndex(0)}
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

      <BottomSheet
        ref={downloadSheetRef}
        snapPoints={["75%"]}
        onChange={(index) => {
          if (downloadPrevIndex.current === -1 && index >= 0)
            setDownloadResetKey((k) => k + 1)
          downloadPrevIndex.current = index
        }}
      >
        <DownloadSheetContent
          key={downloadResetKey}
          videoTitle={video.title}
          duration={video.duration}
          languageName={activeVariant?.languageName ?? null}
          downloads={activeVariant?.downloads ?? []}
          onDownloadComplete={() => setSnackbarVisible(true)}
        />
      </BottomSheet>

      <BottomSheet
        ref={languageSheetRef}
        snapPoints={["75%", "100%"]}
        onChange={(index) => {
          if (languagePrevIndex.current === -1 && index >= 0)
            setLanguageResetKey((k) => k + 1)
          languagePrevIndex.current = index
        }}
      >
        <LanguageSheetContent
          key={languageResetKey}
          variants={video.variants}
          activeVariantSlug={activeVariant?.slug ?? ""}
          onLanguageChange={(variantSlug) => {
            const idx = video.variants.findIndex((v) => v.slug === variantSlug)
            if (idx >= 0) setActiveVariantIndex(idx)
          }}
          onClose={() => languageSheetRef.current?.close()}
        />
      </BottomSheet>

      <BottomSheet
        ref={subtitleSheetRef}
        snapPoints={["75%", "100%"]}
        onChange={(index) => {
          if (subtitlePrevIndex.current === -1 && index >= 0)
            setSubtitleResetKey((k) => k + 1)
          subtitlePrevIndex.current = index
        }}
      >
        <SubtitleSheetContent
          key={subtitleResetKey}
          subtitles={activeVariant?.subtitles ?? []}
          subtitleEnabled={subtitleEnabled}
          activeSubtitleSlug={activeSubtitleSlug}
          onSubtitleChange={(enabled, slug) => {
            setSubtitleEnabled(enabled)
            setActiveSubtitleSlug(slug)
          }}
          onClose={() => subtitleSheetRef.current?.close()}
        />
      </BottomSheet>

      <Snackbar
        message="Download complete"
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
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
