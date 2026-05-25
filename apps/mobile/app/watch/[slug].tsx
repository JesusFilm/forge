import { useMemo } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_VIDEO_BY_SLUG } from "../../src/lib/queries"
import { normalizeVideo } from "../../src/lib/normalizeVideo"
import { TEXT_PRIMARY, TEXT_SECONDARY } from "../../src/lib/color"
import { layout, text } from "../../src/styles/shared"
import { useTypography } from "../../src/hooks/useTypography"

export default function WatchVideoPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const typography = useTypography()

  const { data, loading, error } = useQuery(GET_VIDEO_BY_SLUG, {
    variables: { slug: decodedSlug, locale: "en" },
    skip: !decodedSlug,
    fetchPolicy: "cache-and-network",
  })

  const video = useMemo(() => normalizeVideo(data?.videoBySlug ?? null), [data])

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

  return (
    <View style={layout.screenContainer}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* U3: VideoPlayer will go here */}
        <View style={styles.playerPlaceholder}>
          <Text style={styles.placeholderText}>Player</Text>
        </View>

        {/* U5: VideoMetadata + ActionButtonRow will go here */}
        <View style={styles.metadataSection}>
          <Text style={[styles.label, typography.caption]}>
            {(video.label ?? "").toUpperCase()}
          </Text>
          <Text style={[text.sectionHeading, typography.titleLarge]}>
            {video.title}
          </Text>
          {video.snippet != null && (
            <Text style={[text.sectionSubtitle, typography.bodySmall]}>
              {video.snippet}
            </Text>
          )}
        </View>

        {/* U6: UpNextCarousel will go here */}
        {/* U7: Description, StudyQuestions, BibleQuotes will go here */}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  playerPlaceholder: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    fontFamily: "System",
  },
  metadataSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  label: {
    color: TEXT_SECONDARY,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 4,
    fontFamily: "System",
  },
})
