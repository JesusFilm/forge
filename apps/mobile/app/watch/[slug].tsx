import { useCallback, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/queries"
import type { AdminBlock } from "../../src/lib/queries"
import { normalizeVideo } from "../../src/lib/normalizeVideo"
import { TEXT_PRIMARY } from "../../src/lib/color"
import { layout, text } from "../../src/styles/shared"
import { VideoPlayer } from "../../src/components/watch/VideoPlayer"
import { VideoMetadata } from "../../src/components/watch/VideoMetadata"
import { ActionButtonRow } from "../../src/components/watch/ActionButtonRow"
import { UpNextCarousel } from "../../src/components/watch/UpNextCarousel"
import { VideoDescription } from "../../src/components/watch/VideoDescription"
import { MiniPlayerBar } from "../../src/components/watch/MiniPlayerBar"
import { RelatedQuestionsRenderer } from "../../src/components/sections/RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "../../src/components/sections/BibleQuotesCarouselRenderer"
import { useBibleVerses } from "../../src/hooks/useBibleVerses"
import { DownloadModal } from "../../src/components/watch/DownloadModal"
import { LanguageSubtitleModal } from "../../src/components/watch/LanguageSubtitleModal"
import { ShareModal } from "../../src/components/watch/ShareModal"

const PLAYER_HEIGHT_RATIO = 9 / 16

export default function WatchVideoPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const scrollViewRef = useRef<ScrollView>(null)

  const [showMiniPlayer, setShowMiniPlayer] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [downloadModalVisible, setDownloadModalVisible] = useState(false)
  const [languageModalVisible, setLanguageModalVisible] = useState(false)
  const [shareModalVisible, setShareModalVisible] = useState(false)
  const [activeVariantIndex, setActiveVariantIndex] = useState(0)

  const { data, loading, error } = useQuery(GET_VIDEO_BY_SLUG, {
    variables: { slug: decodedSlug, locale: "en" },
    skip: !decodedSlug,
    fetchPolicy: "cache-and-network",
  })

  const video = useMemo(() => normalizeVideo(data?.videoBySlug ?? null), [data])
  const activeVariant = video?.variants[activeVariantIndex] ?? null
  const bibleQuotes = useBibleVerses(video?.bibleCitations ?? [])

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = e.nativeEvent.contentOffset.y
      const playerThreshold =
        e.nativeEvent.layoutMeasurement.width * PLAYER_HEIGHT_RATIO
      setShowMiniPlayer(scrollY > playerThreshold)
    },
    [],
  )

  const handleScrollToPlayer = useCallback(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true })
  }, [])

  const handlePlayingChange = useCallback((playing: boolean) => {
    setIsPlaying(playing)
  }, [])

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
          streamingUrl={video.streamingUrl}
          posterUrl={video.posterUrl}
          onPlayingChange={handlePlayingChange}
        />

        <VideoMetadata
          label={video.label}
          title={video.title}
          subtitle={video.snippet}
        />

        <ActionButtonRow
          onDownload={() => setDownloadModalVisible(true)}
          onLanguage={() => setLanguageModalVisible(true)}
          onSubtitles={() => setLanguageModalVisible(true)}
          onShare={() => setShareModalVisible(true)}
        />

        {video.siblings.length > 0 && (
          <UpNextCarousel siblings={video.siblings} currentSlug={video.slug} />
        )}

        <VideoDescription description={video.description} />

        {studyQuestionsBlock != null && (
          <RelatedQuestionsRenderer section={studyQuestionsBlock} />
        )}

        {bibleCitationsBlock != null && (
          <BibleQuotesCarouselRenderer section={bibleCitationsBlock} />
        )}
      </ScrollView>

      <MiniPlayerBar
        visible={showMiniPlayer}
        posterUrl={video.posterUrl}
        title={video.title}
        isPlaying={isPlaying}
        onPlayPause={handleScrollToPlayer}
        onPress={handleScrollToPlayer}
      />

      {downloadModalVisible && (
        <DownloadModal
          visible={downloadModalVisible}
          onClose={() => setDownloadModalVisible(false)}
          videoTitle={video.title}
          posterUrl={video.posterUrl}
          duration={video.duration}
          languageName={activeVariant?.languageName ?? null}
          downloads={activeVariant?.downloads ?? []}
        />
      )}

      {languageModalVisible && (
        <LanguageSubtitleModal
          visible={languageModalVisible}
          onClose={() => setLanguageModalVisible(false)}
          variants={video.variants}
          activeVariantSlug={activeVariant?.slug ?? ""}
          onLanguageChange={(variantSlug) => {
            const idx = video.variants.findIndex((v) => v.slug === variantSlug)
            if (idx >= 0) setActiveVariantIndex(idx)
          }}
          subtitles={activeVariant?.subtitles ?? []}
          subtitleEnabled={false}
          activeSubtitleSlug={null}
          onSubtitleChange={() => {}}
        />
      )}

      {shareModalVisible && (
        <ShareModal
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          videoTitle={video.title}
          videoDescription={video.description}
          posterUrl={video.posterUrl}
          videoSlug={video.slug}
          languageSlug={activeVariant?.languageSlug ?? null}
        />
      )}
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
})
