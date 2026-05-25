import { useQuery } from "@apollo/client/react"
import { type AdminResultOf as ResultOf } from "@forge/admin-graphql"
import { LinearGradient } from "expo-linear-gradient"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useCallback, useMemo } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { LIST_EXPERIENCES } from "../../lib/queries"
import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import { FocusableCard } from "../FocusableCard"
import { CATEGORIES, type SearchCategory } from "./categories"

const POPULAR_COUNT = 8

type ListResult = ResultOf<typeof LIST_EXPERIENCES>
type Experience = NonNullable<
  NonNullable<
    NonNullable<NonNullable<ListResult["experiences"]>[number]>["locales"]
  >[number]
>

type Props = {
  recents: string[]
  /** Called when the user presses a Recent chip or a Category card —
   *  parent sets the query to this value and fires an immediate search
   *  (bypassing the debounce). */
  onRunQuery: (query: string) => void
  /** Called when the user presses the "Clear" chip in the Recent rail. */
  onClearHistory: () => void
}

export function SearchBrowse({ recents, onRunQuery, onClearHistory }: Props) {
  const router = useRouter()

  // Reuses home's LIST_EXPERIENCES query so the Apollo cache is warm
  // when the user came from home. If /search is deep-linked directly
  // (cache cold), useQuery fires the network request — same shape as
  // home does on first mount.
  // cache-first explicitly: SearchBrowse only mounts when /search has
  // an empty query, so we want to instantly render whatever the home
  // screen's earlier LIST_EXPERIENCES populated and only network-
  // fetch when nothing's cached yet (deep-link case).
  const { data } = useQuery(LIST_EXPERIENCES, {
    variables: { locale: "en" },
    fetchPolicy: "cache-first",
  })
  const experiences: Experience[] = useMemo(
    () =>
      (data?.experiences ?? [])
        .flatMap(
          (experience) =>
            experience?.locales?.filter(
              (locale) => locale?.slug != null && locale.documentId != null,
            ) ?? [],
        )
        .slice(0, POPULAR_COUNT),
    [data],
  )

  const openExperience = useCallback(
    (slug: string) => {
      router.push(`/experience/${encodeURIComponent(slug)}`)
    },
    [router],
  )

  const showRecent = recents.length > 0

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
    >
      {showRecent ? (
        <View style={styles.railContainer}>
          <Text style={styles.railTitle} accessibilityRole="header">
            Recent
          </Text>
          <RecentRow
            recents={recents}
            onRunQuery={onRunQuery}
            onClearHistory={onClearHistory}
          />
        </View>
      ) : null}

      <View style={styles.railContainer}>
        <Text style={styles.railTitle} accessibilityRole="header">
          Browse topics
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRowContent}
        >
          {CATEGORIES.map((cat) => (
            // Per-cell wrapper provides the breathing room the focus
            // glow needs (shadowRadius scale(16) + 1.05x scale on the
            // FocusableCard ≈ 21dp outward on each side). Without this,
            // ScrollView clips the glow at the contentContainer edges.
            // Same pattern as ContentRail's itemWrapper on home.
            <View key={cat.searchTerm} style={styles.categoryCellWrapper}>
              <CategoryCard
                category={cat}
                onPress={() => onRunQuery(cat.searchTerm)}
              />
            </View>
          ))}
        </ScrollView>
      </View>

      {experiences.length > 0 ? (
        <View style={styles.railContainer}>
          <Text style={styles.railTitle} accessibilityRole="header">
            Popular experiences
          </Text>
          {/* Inline horizontal ScrollView matching the chip + category
              row patterns above, NOT the home-screen ContentRail.
              ContentRail is tuned for the home screen's edge-to-edge
              layout and hardcodes paddingHorizontal: scale(80) on both
              its title and listContent. Inside the /search right pane
              that 80dp gutter sits on TOP of the rightPane's own
              padding (32dp), pushing the Popular row visibly further
              right than the Recent / Browse topics rows above it.
              Reusing the local rail styling keeps all three rails
              starting at the same X column inside the panel. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.popularRowContent}
          >
            {experiences.map((item) => {
              const imageUrl = resolveImageUrl(item.ogImageUrl)
              return (
                <View
                  key={item.documentId ?? item.slug ?? "experience"}
                  style={styles.popularCellWrapper}
                >
                  <FocusableCard
                    onPress={() => {
                      if (item.slug) openExperience(item.slug)
                    }}
                    accessibilityLabel={item.title ?? "Untitled"}
                    accessibilityHint="Opens this experience"
                    style={styles.popularCard}
                  >
                    {imageUrl != null ? (
                      <Image
                        source={{ uri: imageUrl }}
                        style={styles.popularImage}
                        contentFit="cover"
                        recyclingKey={`popular-${item.documentId ?? item.slug}`}
                      />
                    ) : (
                      <View
                        style={[styles.popularImage, styles.popularFallback]}
                      />
                    )}
                    <View style={styles.popularText}>
                      <Text style={styles.popularTitle} numberOfLines={2}>
                        {item.title ?? "Untitled"}
                      </Text>
                    </View>
                  </FocusableCard>
                </View>
              )
            })}
          </ScrollView>
        </View>
      ) : null}
    </ScrollView>
  )
}

function RecentRow({
  recents,
  onRunQuery,
  onClearHistory,
}: {
  recents: string[]
  onRunQuery: (q: string) => void
  onClearHistory: () => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRowContent}
    >
      {recents.map((q) => (
        <View key={`recent-${q}`} style={styles.chipCellWrapper}>
          <FocusableCard
            onPress={() => onRunQuery(q)}
            accessibilityLabel={`Recent search: ${q}`}
            accessibilityHint="Re-runs this search"
            style={styles.chip}
          >
            <View style={styles.chipInner}>
              <Text style={styles.chipText} numberOfLines={1}>
                {q}
              </Text>
            </View>
          </FocusableCard>
        </View>
      ))}
      <View style={styles.chipCellWrapper}>
        <FocusableCard
          onPress={onClearHistory}
          accessibilityLabel="Clear search history"
          accessibilityHint="Removes every entry in the recent searches list"
          style={styles.clearChip}
        >
          <View style={styles.chipInner}>
            <Text style={styles.clearText}>Clear</Text>
          </View>
        </FocusableCard>
      </View>
    </ScrollView>
  )
}

function CategoryCard({
  category,
  onPress,
}: {
  category: SearchCategory
  onPress: () => void
}) {
  return (
    <FocusableCard
      onPress={onPress}
      accessibilityLabel={`${category.title} category`}
      accessibilityHint={`Searches for "${category.searchTerm}"`}
      style={styles.categoryCard}
    >
      <LinearGradient
        colors={[
          hexToRgba(category.colors[0], 1),
          hexToRgba(category.colors[1], 1),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.categoryGradient}
      >
        <Text style={styles.categoryTitle}>{category.title}</Text>
      </LinearGradient>
    </FocusableCard>
  )
}

const CATEGORY_W = scale(220)
const CATEGORY_H = scale(124)
const POPULAR_W = scale(240)
const POPULAR_IMG_H = scale(136)

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: scale(8),
    gap: scale(8),
  },
  railContainer: {
    marginBottom: scale(24),
  },
  railTitle: {
    fontFamily: "System",
    fontSize: scale(18),
    color: COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: scale(10),
  },
  chipRowContent: {
    // Start/end gutter so the leftmost / rightmost chip has room for
    // its focus glow inside the ScrollView's clip region. Inter-chip
    // spacing comes from chipCellWrapper.paddingHorizontal — see
    // categoryCellWrapper for the same pattern's rationale.
    paddingHorizontal: scale(24),
  },
  chipCellWrapper: {
    paddingVertical: scale(28),
    paddingHorizontal: scale(12),
  },
  chip: {
    backgroundColor: COLORS.surfaceContainerHigh,
    paddingHorizontal: scale(16),
    paddingVertical: scale(10),
  },
  clearChip: {
    backgroundColor: COLORS.surfaceContainer,
    paddingHorizontal: scale(16),
    paddingVertical: scale(10),
  },
  chipInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontFamily: "System",
    fontSize: scale(14),
    fontWeight: "500",
    color: COLORS.text,
    maxWidth: scale(160),
  },
  clearText: {
    fontFamily: "System",
    fontSize: scale(14),
    fontWeight: "500",
    color: COLORS.muted,
  },
  categoryRowContent: {
    // Start/end gutter so the leftmost / rightmost card's focus glow
    // is not clipped against the ScrollView's contentContainer edge.
    // Inter-card spacing comes from categoryCellWrapper.paddingHorizontal
    // (so each card carries its own focus halo padding instead of
    // relying on `gap`, which doesn't reserve glow room).
    paddingHorizontal: scale(24),
  },
  categoryCellWrapper: {
    // Vertical: shadowRadius (scale(16)) + 1.05x scale expansion (~5dp)
    // ≈ 21dp at minimum; bumped to 32dp for visual breathing room
    // beyond the bare-clipping threshold.
    paddingVertical: scale(32),
    // Horizontal: 16dp on each side gives 32dp between adjacent cards
    // (more generous than the original `gap: scale(16)` look). The
    // 16dp shadow can blend into the neighbour's halo — that's
    // expected; only the focused card glows at any time.
    paddingHorizontal: scale(16),
  },
  categoryCard: {
    width: CATEGORY_W,
    height: CATEGORY_H,
    overflow: "hidden",
  },
  categoryGradient: {
    flex: 1,
    justifyContent: "flex-end",
    padding: scale(14),
  },
  categoryTitle: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "700",
    // Use the tinted near-white from the palette rather than pure
    // #FFFFFF — Crimson Gallery's text token already reads as white
    // on saturated category gradients while staying consistent with
    // the rest of the app's typography.
    color: COLORS.text,
    // Same logic for the shadow: the warm-stone surface tone tints
    // the drop shadow toward the rest of the design system instead
    // of dropping a literal #000.
    textShadowColor: hexToRgba(COLORS.surface, 0.45),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  popularRowContent: {
    // Match chipRowContent / categoryRowContent so the Popular row's
    // leftmost card lines up at the same X column as the Recent chips
    // and Browse-topics cards above it. Without this the row would
    // start at X=0 of its container and lose the focus-glow gutter.
    paddingHorizontal: scale(24),
  },
  popularCellWrapper: {
    // Vertical halo headroom mirrors categoryCellWrapper (scale(32))
    // since the popular cards have the same 1.05x scale + scale(16)
    // shadow on focus. Horizontal mirror at scale(16) matches the
    // category row's inter-card gap so all three rails feel like
    // siblings, not three different rhythms.
    paddingVertical: scale(32),
    paddingHorizontal: scale(16),
  },
  popularCard: {
    width: POPULAR_W,
    backgroundColor: COLORS.surfaceContainer,
    overflow: "hidden",
  },
  popularImage: {
    width: POPULAR_W,
    height: POPULAR_IMG_H,
    borderTopLeftRadius: scale(16),
    borderTopRightRadius: scale(16),
  },
  popularFallback: {
    backgroundColor: COLORS.surfaceContainerHigh,
  },
  popularText: {
    padding: scale(12),
  },
  popularTitle: {
    fontFamily: "System",
    fontSize: scale(14),
    fontWeight: "600",
    color: COLORS.text,
  },
})
