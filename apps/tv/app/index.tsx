import { useQuery } from "@apollo/client/react"
import { type ResultOf } from "@forge/graphql"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { ContentRail } from "../src/components/ContentRail"
import { FocusableCard } from "../src/components/FocusableCard"
import { HomeHero, type HomeHeroData } from "../src/components/HomeHero"
import { resolveImageUrl, getMuxThumbnailUrl } from "../src/lib/resolveImageUrl"
import { scale } from "../src/lib/scale"
import { pickThumbnailUrl } from "../src/lib/types"
import { LIST_EXPERIENCES } from "../src/lib/queries"

/** Crimson Gallery design tokens */
const COLORS = {
  surface: "#161311",
  surfaceContainer: "#221F1D",
  primary: "#CB333B",
  text: "#F5F5F4",
  muted: "#A8A29E",
} as const

const CARD_WIDTH = scale(280)
const CARD_IMAGE_HEIGHT = scale(158)

/**
 * Debounce window between a rail card becoming focused and the hero
 * committing to that experience. Tune-here constant. Short enough to
 * feel responsive, long enough to skip cards the user blows past.
 */
const FOCUS_DEBOUNCE_MS = 300

type ListResult = ResultOf<typeof LIST_EXPERIENCES>
type Experience = NonNullable<NonNullable<ListResult["experiences"]>[number]>
type ExperienceBlock = NonNullable<Experience["blocks"]>[number]
type VideoHeroBlock = Extract<
  ExperienceBlock,
  { __typename: "ComponentSectionsVideoHero" }
>

function findVideoHeroBlock(experience: Experience): VideoHeroBlock | null {
  const blocks = experience.blocks ?? []
  for (const block of blocks) {
    if (block?.__typename === "ComponentSectionsVideoHero") {
      return block
    }
  }
  return null
}

/**
 * Build the hero data payload for a given experience. Prefers the
 * experience's first ComponentSectionsVideoHero block's fields
 * (heading/subheading/streamingUrl/video images). Falls back to
 * experience-level title, metaDescription, and ogImage so experiences
 * without a hero block still render cleanly.
 */
function buildHeroData(experience: Experience): HomeHeroData {
  const heroBlock = findVideoHeroBlock(experience)
  type VideoImage = NonNullable<
    NonNullable<NonNullable<VideoHeroBlock["video"]>["images"]>[number]
  >
  const videoImages = heroBlock?.video?.images?.filter(
    (img): img is VideoImage => img != null,
  )

  const streamingUrl = heroBlock?.streamingUrl ?? null

  const posterUrl =
    resolveImageUrl(pickThumbnailUrl(videoImages)) ??
    getMuxThumbnailUrl(streamingUrl) ??
    resolveImageUrl(experience.ogImage?.url ?? null)

  return {
    id: experience.documentId,
    title: heroBlock?.heading ?? experience.title ?? "",
    subtitle: heroBlock?.subheading ?? experience.metaDescription ?? null,
    streamingUrl,
    posterUrl,
  }
}

export default function HomeScreen() {
  const router = useRouter()
  const [retryFocused, setRetryFocused] = useState(false)

  const {
    data: listData,
    loading: listLoading,
    error: listError,
    refetch: listRefetch,
  } = useQuery(LIST_EXPERIENCES, { variables: { locale: "en" } })

  const experiences = useMemo(
    () =>
      (listData?.experiences ?? []).filter((e): e is Experience => e != null),
    [listData],
  )

  const homepageExperience = useMemo(
    () => experiences.find((e) => e.isHomepage) ?? experiences[0] ?? null,
    [experiences],
  )

  // Focus-driven hero state machine (inline — single consumer).
  // committedId = which experience the hero currently reflects.
  // Debounce timer resets on every onItemFocus; commit fires on timeout.
  const [committedId, setCommittedId] = useState<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAnnouncedIdRef = useRef<string | null>(null)

  // Seed committedId once homepageExperience is known.
  useEffect(() => {
    if (committedId == null && homepageExperience != null) {
      setCommittedId(homepageExperience.documentId)
    }
  }, [homepageExperience, committedId])

  // Clear any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
    }
  }, [])

  const openExperience = useCallback(
    (slug: string) => {
      router.push(`/experience/${encodeURIComponent(slug)}`)
    },
    [router],
  )

  const handleItemFocus = useCallback((_index: number, item: Experience) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = setTimeout(() => {
      setCommittedId(item.documentId)
      debounceTimer.current = null
    }, FOCUS_DEBOUNCE_MS)
  }, [])

  const committedExperience = useMemo(
    () =>
      committedId
        ? (experiences.find((e) => e.documentId === committedId) ?? null)
        : null,
    [committedId, experiences],
  )

  const hero: HomeHeroData | null = useMemo(() => {
    if (!committedExperience) return null
    return buildHeroData(committedExperience)
  }, [committedExperience])

  // Accessibility: announce hero changes for VoiceOver/TalkBack users.
  // Fires once per *commit*, not on every transient focus event. Guards
  // against re-announcing the already-announced id (e.g., when focus
  // returns to the already-committed card after a brief detour).
  useEffect(() => {
    if (!hero || hero.id === lastAnnouncedIdRef.current) return
    // Skip announcement for the initial auto-seeded hero — the screen
    // itself is the focus event for first mount.
    if (lastAnnouncedIdRef.current !== null) {
      const announcement = [hero.title, hero.subtitle]
        .filter(Boolean)
        .join(". ")
      if (announcement.length > 0) {
        AccessibilityInfo.announceForAccessibility(announcement)
      }
    }
    lastAnnouncedIdRef.current = hero.id
  }, [hero])

  // ── Loading state ──
  if (listLoading && !listData) {
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
      {/* Hero area — non-interactive, reflects the currently
          committed experience. Focus on this screen lives entirely
          on the rail below. */}
      <HomeHero hero={hero} />

      {/* Experiences rail — ContentRail's TVFocusGuideView autoFocus
          claims initial focus on the first card. */}
      <View style={styles.railContainer}>
        <ContentRail
          title="Experiences"
          railId="home-experiences"
          data={experiences}
          keyExtractor={(item) => item.documentId}
          onItemFocus={handleItemFocus}
          renderItem={(item, _index, hooks) => {
            const imageUrl = resolveImageUrl(item.ogImage?.url ?? null)
            return (
              <FocusableCard
                onPress={() => openExperience(item.slug)}
                onFocus={hooks.onFocus}
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
    paddingBottom: scale(80),
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: scale(80),
  },
  railContainer: {
    marginTop: scale(24),
  },
  // ── Error state ──
  errorText: {
    fontFamily: "System",
    fontSize: scale(28),
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: scale(8),
  },
  errorDetail: {
    fontFamily: "System",
    fontSize: scale(18),
    color: COLORS.muted,
    marginBottom: scale(32),
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: scale(40),
    paddingVertical: scale(16),
    borderRadius: scale(28),
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
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.text,
  },
  // ── Empty state ──
  emptyText: {
    fontFamily: "System",
    fontSize: scale(24),
    color: COLORS.muted,
  },
  // ── Card styles ──
  card: {
    width: CARD_WIDTH,
    backgroundColor: COLORS.surfaceContainer,
    overflow: "hidden",
  },
  cardImage: {
    width: CARD_WIDTH,
    height: CARD_IMAGE_HEIGHT,
    borderTopLeftRadius: scale(16),
    borderTopRightRadius: scale(16),
  },
  cardImageFallback: {
    backgroundColor: COLORS.surfaceContainer,
  },
  cardTextContainer: {
    padding: scale(12),
  },
  cardTitle: {
    fontFamily: "System",
    fontSize: scale(16),
    fontWeight: "600",
    color: COLORS.text,
  },
})
