import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useExperienceContext } from "../../src/contexts/ExperienceProvider"
import { useExperienceSelection } from "../../src/contexts/ExperienceSelectionProvider"
import { MyDownloadsSection } from "../../src/components/watch/MyDownloadsSection"
import { useTypography } from "../../src/hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../src/lib/color"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { layout } from "../../src/styles/shared"

// Admin's `experiences` list query is ABAC-gated (not public).
// Until it is widened, the library shows only the active experience.

export default function LibraryScreen() {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const router = useRouter()
  const { experience, loading } = useExperienceContext()
  const { currentSlug } = useExperienceSelection()

  // The Experience card depends on network/ABAC data; My Downloads does not, so
  // it always renders above (reachable offline).
  const experienceCard = (() => {
    if (loading && !experience) {
      return <Text style={styles.message}>Loading…</Text>
    }
    if (!experience) {
      return <Text style={styles.message}>No experience loaded</Text>
    }
    const imageUrl = resolveImageUrl(experience.ogImageUrl ?? null)
    const isActive = experience.slug === currentSlug
    // currentSlug is always set when an experience is loaded; the fragment's
    // slug is the nullable-typed fallback.
    const targetSlug = currentSlug ?? experience.slug
    return (
      <Pressable
        onPress={() => {
          if (targetSlug == null) return
          router.push(`/experience/${encodeURIComponent(targetSlug)}`)
        }}
        style={[styles.card, isActive && styles.cardActive]}
        accessibilityRole="button"
        accessibilityLabel={`${experience.title ?? "Untitled experience"}, currently active`}
      >
        <View style={styles.cardThumbnail}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.cardImage}
              contentFit="cover"
              recyclingKey={`library-${experience.id}`}
              accessibilityLabel={experience.title ?? "Experience thumbnail"}
            />
          ) : (
            <LinearGradient
              colors={[SURFACE_COLOR, hexToRgba(SURFACE_COLOR, 0.6)]}
              style={styles.cardImage}
            >
              <Ionicons
                name="albums-outline"
                size={32}
                color={TEXT_SECONDARY}
              />
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
  })()

  return (
    <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
      <Text style={[styles.header, typography.heading]}>Library</Text>
      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        <MyDownloadsSection />
        <Text style={[styles.subheader, typography.titleSmall]}>
          Experiences
        </Text>
        {experienceCard}
      </ScrollView>
    </View>
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
  subheader: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
    marginBottom: 10,
  },
  message: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 16,
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
