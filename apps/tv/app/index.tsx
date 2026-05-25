import { useQuery } from "@apollo/client/react"
import { type AdminResultOf as ResultOf } from "@forge/admin-graphql"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"
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
import { HomeHeader } from "../src/components/HomeHeader"
import { HomeHero, type HomeHeroData } from "../src/components/HomeHero"
import { COLORS } from "../src/lib/colors"
import { resolveImageUrl, getMuxThumbnailUrl } from "../src/lib/resolveImageUrl"
import { scale } from "../src/lib/scale"
import { LIST_EXPERIENCES } from "../src/lib/queries"

const CARD_WIDTH = scale(280)
const CARD_IMAGE_HEIGHT = scale(158)

/**
 * Debounce window between a rail card becoming focused and the hero
 * committing to that experience. Tune-here constant. Short enough to
 * feel responsive, long enough to skip cards the user blows past.
 */
const FOCUS_DEBOUNCE_MS = 300

type ListResult = ResultOf<typeof LIST_EXPERIENCES>
type Experience = NonNullable<
  NonNullable<
    NonNullable<NonNullable<ListResult["experiences"]>[number]>["locales"]
  >[number]
>
type ExperienceBlock = NonNullable<Experience["blocks"]>[number]
type VideoHeroBlock = Extract<ExperienceBlock, { __typename: "VideoHeroBlock" }>
// Compile-time probe: if gql.tada's union for the blocks dynamic zone
// fails to expose discriminated __typename literals per block, `Extract`
// silently yields `never` and all property access inside buildHeroData
// types as `never` with no tsc error. These asserts force tsc to error
// if the type has collapsed. Remove only if intentionally changing the
// type derivation.
type _AssertVideoHeroBlockIsNotNever = VideoHeroBlock extends never
  ? "ERROR: VideoHeroBlock resolved to never — Extract against __typename failed"
  : true
type _AssertVideoHeroHasStreamingUrl = VideoHeroBlock["streamingUrl"] extends
  | string
  | null
  | undefined
  ? true
  : "ERROR: VideoHeroBlock.streamingUrl typing collapsed"
const _videoHeroTypeChecks: [
  _AssertVideoHeroBlockIsNotNever,
  _AssertVideoHeroHasStreamingUrl,
] = [true, true]
void _videoHeroTypeChecks

function findVideoHeroBlock(experience: Experience): VideoHeroBlock | null {
  const blocks = experience.blocks ?? []
  for (const block of blocks) {
    if (block?.__typename === "VideoHeroBlock") {
      return block
    }
  }
  return null
}

/**
 * Build the hero data payload for a given experience. Prefers the
 * experience's first VideoHeroBlock fields. Falls back to
 * experience-level title, metaDescription, and ogImageUrl so experiences
 * without a hero block still render cleanly.
 */
function buildHeroData(experience: Experience): HomeHeroData {
  const heroBlock = findVideoHeroBlock(experience)
  const streamingUrl = heroBlock?.streamingUrl ?? null

  const posterUrl =
    getMuxThumbnailUrl(streamingUrl) ?? resolveImageUrl(experience.ogImageUrl)

  return {
    id: experience.documentId ?? experience.slug ?? "",
    title: heroBlock?.heading ?? experience.title ?? "",
    subtitle: heroBlock?.subheading ?? experience.metaDescription ?? null,
    streamingUrl,
    posterUrl,
  }
}

export default function HomeScreen() {
  const router = useRouter()
  const [retryFocused, setRetryFocused] = useState(false)

  // Back-from-/search focus restoration. tvos#852 workaround: on every
  // regain-focus after the first real mount, bump a key that tells
  // <HomeHeader /> to apply hasTVPreferredFocus to its Search chip.
  // Skip the first mount so the rail's TVFocusGuideView autoFocus wins
  // on initial home render.
  //
  // Counter (not boolean) to absorb React Strict Mode's deliberate
  // double-invoke of effects in dev: the first invocation flipped a
  // boolean, the second invocation then bumped the focus key on initial
  // mount, claiming chip focus before the rail had a chance. With a
  // counter we wait for the *third* run-through (Strict Mode
  // mount-unmount-mount + first navigation back) before bumping.
  const [searchChipFocusKey, setSearchChipFocusKey] = useState(0)
  const focusEffectRunCountRef = useRef(0)
  useFocusEffect(
    useCallback(() => {
      focusEffectRunCountRef.current += 1
      // In production the cleanup-and-rerun pattern of Strict Mode
      // does not fire, so the first real run is run #1. In dev,
      // Strict Mode produces runs #1 (mount) + #2 (immediate
      // remount) before any user navigation; the first back-from-
      // /search lands as run #3. Skip everything before #2 so dev
      // matches prod first-render behavior.
      const STRICT_MODE_DEV_RUNS = 1
      if (focusEffectRunCountRef.current <= STRICT_MODE_DEV_RUNS + 1) return
      setSearchChipFocusKey((k) => k + 1)
    }, []),
  )

  const {
    data: listData,
    loading: listLoading,
    error: listError,
    refetch: listRefetch,
  } = useQuery(LIST_EXPERIENCES, { variables: { locale: "en" } })

  const experiences = useMemo(
    () =>
      (listData?.experiences ?? []).flatMap(
        (experience) =>
          experience?.locales?.filter((locale) => locale != null) ?? [],
      ),
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
      setCommittedId(homepageExperience.documentId ?? homepageExperience.slug)
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
      setCommittedId(item.documentId ?? item.slug)
      debounceTimer.current = null
    }, FOCUS_DEBOUNCE_MS)
  }, [])

  // Use committedId when set, otherwise fall back to the homepage
  // experience's id so the hero renders on the very first paint rather
  // than waiting for the seeding effect to fire (which would flash a
  // blank hero for ~50-100ms on TV hardware).
  const effectiveCommittedId =
    committedId ??
    homepageExperience?.documentId ??
    homepageExperience?.slug ??
    null

  const committedExperience = useMemo(
    () =>
      effectiveCommittedId
        ? (experiences.find(
            (e) =>
              e.documentId === effectiveCommittedId ||
              e.slug === effectiveCommittedId,
          ) ?? null)
        : null,
    [effectiveCommittedId, experiences],
  )

  const hero: HomeHeroData | null = useMemo(() => {
    if (!committedExperience) return null
    return buildHeroData(committedExperience)
  }, [committedExperience])

  // Accessibility: announce hero changes for VoiceOver/TalkBack users.
  // Fires once per *commit*, not on every transient focus event. Guards
  // against re-announcing the already-announced id (e.g., when focus
  // returns to the already-committed card after a brief detour).
  // Dep on `hero?.id` (not the object) so cache re-normalisations that
  // produce a new object identity for the same experience don't force a
  // re-announce.
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
  }, [hero?.id, hero?.title, hero?.subtitle])

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
      // stickyHeaderIndices={[0]} pins the HomeHeader (first child)
      // to the top of the viewport during scroll. Keeps the nav
      // visible even when focus auto-scrolls to the rail on cold
      // mount, while still leaving the chip INSIDE the ScrollView
      // so the tvOS focus engine can traverse between it and the
      // rail without crossing a parent-View boundary (which it
      // cannot — proven empirically; D-pad-up was a no-op when the
      // header was a sibling of the ScrollView).
      stickyHeaderIndices={[0]}
    >
      {/* Top-row nav slot — Netflix-style horizontally-centered pill
          row. First child of the ScrollView so stickyHeaderIndices
          pins it. Above the hero in DOM order to keep focusables
          out of the playing VideoView region (see
          docs/solutions/best-practices/tv-focus-driven-hero-
          patterns-20260420.md). */}
      <HomeHeader
        key={`home-header-${searchChipFocusKey}`}
        searchChipPreferredFocus={searchChipFocusKey > 0}
      />

      {/* Hero area — non-interactive, reflects the currently
          committed experience. */}
      <HomeHero hero={hero} />

      {/* Experiences rail — ContentRail's TVFocusGuideView autoFocus
          claims initial focus on the first card. */}
      <View style={styles.railContainer}>
        <ContentRail
          title="Experiences"
          railId="home-experiences"
          data={experiences}
          keyExtractor={(item) => item.documentId ?? item.slug ?? "experience"}
          onItemFocus={handleItemFocus}
          renderItem={(item, _index, hooks) => {
            const imageUrl = resolveImageUrl(item.ogImageUrl)
            return (
              <FocusableCard
                onPress={() => {
                  if (item.slug) openExperience(item.slug)
                }}
                onFocus={hooks.onFocus}
                style={styles.card}
              >
                {imageUrl ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={styles.cardImage}
                    contentFit="cover"
                    recyclingKey={`card-${item.documentId ?? item.slug}`}
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
