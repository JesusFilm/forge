import { useQuery } from "@apollo/client/react"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { ContentRail } from "../src/components/ContentRail"
import { FocusableCard } from "../src/components/FocusableCard"
import { HomeHero } from "../src/components/HomeHero"
import { resolveImageUrl } from "../src/lib/resolveImageUrl"
import { LIST_EXPERIENCES, GET_WATCH_EXPERIENCE } from "../src/lib/queries"

/** Crimson Gallery design tokens */
const COLORS = {
  surface: "#161311",
  surfaceContainer: "#221F1D",
  primary: "#CB333B",
  text: "#F5F5F4",
  muted: "#A8A29E",
} as const

const CARD_WIDTH = 280
const CARD_IMAGE_HEIGHT = 158

export default function HomeScreen() {
  const router = useRouter()
  const [retryFocused, setRetryFocused] = useState(false)

  const {
    data: listData,
    loading: listLoading,
    error: listError,
    refetch: listRefetch,
  } = useQuery(LIST_EXPERIENCES, { variables: { locale: "en" } })

  const experiences = (listData?.experiences ?? []).filter(
    (e): e is NonNullable<typeof e> => e != null,
  )
  const homepageExperience = experiences.find((e) => e.isHomepage)

  const { data: heroData, loading: heroLoading } = useQuery(
    GET_WATCH_EXPERIENCE,
    {
      variables: {
        locale: "en",
        filters: { slug: { eq: homepageExperience?.slug ?? "" } },
      },
      skip: !homepageExperience?.slug,
    },
  )

  // Extract hero image from the homepage experience's first videoHero block
  const heroExperience = heroData?.experiences?.[0]
  const heroBlocks = (heroExperience?.blocks ?? []).filter(
    (b): b is NonNullable<typeof b> => b != null,
  )
  const heroBlock = heroBlocks.find(
    (b) => b.__typename === "ComponentSectionsVideoHero",
  )
  const heroVideoStill = (() => {
    if (
      heroBlock == null ||
      heroBlock.__typename !== "ComponentSectionsVideoHero"
    )
      return null
    const images = heroBlock.video?.images
    if (!Array.isArray(images) || images.length === 0) return null
    const first = images[0]
    return first?.videoStill ?? null
  })()

  // Fallback to ogImage if no videoHero image
  const finalHeroImage =
    resolveImageUrl(heroVideoStill) ??
    resolveImageUrl(homepageExperience?.ogImage?.url ?? null)

  const isLoading = listLoading || heroLoading

  // ── Loading state ──
  if (isLoading && !listData) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    )
  }

  // ── Error state ──
  if (listError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Something went wrong</Text>
        <Text style={styles.errorDetail}>{listError.message}</Text>
        <Pressable
          onFocus={() => setRetryFocused(true)}
          onBlur={() => setRetryFocused(false)}
          style={[
            styles.retryButton,
            retryFocused && styles.retryButtonFocused,
          ]}
          onPress={() => void listRefetch()}
          hasTVPreferredFocus
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    )
  }

  // ── Empty state ──
  if (experiences.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No experiences available</Text>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
    >
      {/* Hero area */}
      {homepageExperience ? (
        <HomeHero
          title={homepageExperience.title ?? ""}
          subtitle={homepageExperience.metaDescription ?? undefined}
          imageUrl={finalHeroImage}
        />
      ) : null}

      {/* Experiences rail */}
      <View style={styles.railContainer}>
        <ContentRail
          title="Experiences"
          railId="home-experiences"
          data={experiences}
          keyExtractor={(item) => item.documentId}
          renderItem={(item) => {
            const imageUrl = resolveImageUrl(item.ogImage?.url ?? null)
            return (
              <FocusableCard
                onPress={() => {
                  router.push(`/experience/${encodeURIComponent(item.slug)}`)
                }}
                style={styles.card}
              >
                {imageUrl ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={styles.cardImage}
                    contentFit="cover"
                    recyclingKey={`card-${item.documentId}`}
                  />
                ) : (
                  <View style={[styles.cardImage, styles.cardImageFallback]} />
                )}
                <View style={styles.cardTextContainer}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.title ?? "Untitled"}
                  </Text>
                </View>
              </FocusableCard>
            )
          }}
        />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  scrollContent: {
    paddingBottom: 80,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: 80,
  },
  railContainer: {
    marginTop: 24,
  },
  // ── Error state ──
  errorText: {
    fontFamily: "System",
    fontSize: 28,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 8,
  },
  errorDetail: {
    fontFamily: "System",
    fontSize: 18,
    color: COLORS.muted,
    marginBottom: 32,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
  },
  retryButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: COLORS.primary,
    shadowRadius: 20,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
  retryText: {
    fontFamily: "System",
    fontSize: 20,
    fontWeight: "600",
    color: COLORS.text,
  },
  // ── Empty state ──
  emptyText: {
    fontFamily: "System",
    fontSize: 24,
    color: COLORS.muted,
  },
  // ── Card styles ──
  card: {
    width: CARD_WIDTH,
    overflow: "hidden",
  },
  cardImage: {
    width: CARD_WIDTH,
    height: CARD_IMAGE_HEIGHT,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  cardImageFallback: {
    backgroundColor: COLORS.surfaceContainer,
  },
  cardTextContainer: {
    padding: 12,
  },
  cardTitle: {
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
  },
})
