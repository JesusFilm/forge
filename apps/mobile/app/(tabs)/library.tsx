import { Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { FlashList } from "@shopify/flash-list"
import { useQuery } from "@apollo/client/react"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { LIST_EXPERIENCES } from "../../src/lib/queries"
import { useExperienceSelection } from "../../src/contexts/ExperienceSelectionProvider"
import { useTypography } from "../../src/hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../src/lib/color"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { layout, button } from "../../src/styles/shared"

// ── Component ──────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const router = useRouter()
  const { currentSlug, selectExperience } = useExperienceSelection()

  const { data, loading, error, refetch } = useQuery(LIST_EXPERIENCES, {
    variables: { locale: "en" },
    fetchPolicy: "cache-and-network",
  })

  const experiences = (data?.experiences ?? []).filter(
    (e): e is NonNullable<typeof e> => e !== null,
  )

  const handleSelect = (slug: string) => {
    if (slug !== currentSlug) {
      selectExperience(slug)
    }
    router.navigate("/(tabs)/")
  }

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading && experiences.length === 0) {
    return (
      <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
        <Text style={[styles.header, typography.heading]}>Library</Text>
        <View style={styles.center}>
          <Text style={styles.message}>Loading experiences...</Text>
        </View>
      </View>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error && experiences.length === 0) {
    return (
      <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
        <Text style={[styles.header, typography.heading]}>Library</Text>
        <View style={styles.center}>
          <Text style={styles.message}>Failed to load experiences</Text>
          <Pressable
            onPress={() => refetch()}
            style={[button.accent, styles.retryButtonExtra]}
            accessibilityRole="button"
            accessibilityLabel="Retry loading experiences"
          >
            <Text style={button.accentText}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (experiences.length === 0) {
    return (
      <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
        <Text style={[styles.header, typography.heading]}>Library</Text>
        <View style={styles.center}>
          <Text style={styles.message}>No experiences available</Text>
        </View>
      </View>
    )
  }

  // ── List ───────────────────────────────────────────────────────────────
  return (
    <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
      <Text style={[styles.header, typography.heading]}>Library</Text>
      <FlashList
        data={experiences}
        keyExtractor={(item) => item.documentId}
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => (
          <ExperienceCard
            experience={item}
            index={index}
            isActive={item.slug === currentSlug}
            onSelect={handleSelect}
          />
        )}
      />
    </View>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────

function ExperienceCard({
  experience,
  index,
  isActive,
  onSelect,
}: {
  experience: {
    documentId: string
    slug: string
    title: string | null
    metaDescription: string | null
    ogImage: { url: string; alternativeText: string | null } | null
  }
  index: number
  isActive: boolean
  onSelect: (slug: string) => void
}) {
  const typography = useTypography()
  const imageUrl = resolveImageUrl(experience.ogImage?.url)

  return (
    <Pressable
      testID={`experience-card-${index}`}
      onPress={() => onSelect(experience.slug)}
      style={[styles.card, isActive && styles.cardActive]}
      accessibilityRole="button"
      accessibilityLabel={`${experience.title ?? "Untitled experience"}${isActive ? ", currently active" : ""}`}
    >
      <View style={styles.cardThumbnail}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.cardImage}
            contentFit="cover"
            recyclingKey={`library-${experience.documentId}`}
            accessibilityLabel={
              experience.ogImage?.alternativeText ??
              experience.title ??
              "Experience thumbnail"
            }
          />
        ) : (
          <LinearGradient
            colors={[SURFACE_COLOR, hexToRgba(SURFACE_COLOR, 0.6)]}
            style={styles.cardImage}
          >
            <Ionicons name="albums-outline" size={32} color={TEXT_SECONDARY} />
          </LinearGradient>
        )}
      </View>
      <View style={styles.cardContent}>
        <View style={styles.cardTitleRow}>
          <Text
            style={[styles.cardTitle, typography.titleSmall]}
            numberOfLines={2}
          >
            {experience.title ?? "Untitled"}
          </Text>
          {isActive && (
            <View style={styles.activeBadge}>
              <Ionicons name="checkmark-circle" size={20} color={ACCENT} />
            </View>
          )}
        </View>
        {experience.metaDescription ? (
          <Text
            style={[styles.cardDescription, typography.caption]}
            numberOfLines={2}
          >
            {experience.metaDescription}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────

const CARD_IMAGE_SIZE = 80
const CARD_RADIUS = 12

const styles = StyleSheet.create({
  header: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  message: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 16,
    textAlign: "center",
  },
  retryButtonExtra: {
    marginTop: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    flexDirection: "row",
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_RADIUS,
    marginBottom: 12,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardActive: {
    borderColor: ACCENT,
  },
  cardThumbnail: {
    width: CARD_IMAGE_SIZE,
    height: CARD_IMAGE_SIZE,
  },
  cardImage: {
    width: CARD_IMAGE_SIZE,
    height: CARD_IMAGE_SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  cardContent: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    flex: 1,
  },
  activeBadge: {
    marginLeft: 8,
  },
  cardDescription: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginTop: 4,
  },
})
