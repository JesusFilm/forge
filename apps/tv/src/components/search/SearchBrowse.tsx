import { useQuery } from "@apollo/client/react"
import { type ResultOf } from "@forge/graphql"
import { LinearGradient } from "expo-linear-gradient"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useCallback, useMemo } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { LIST_EXPERIENCES } from "../../lib/queries"
import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import { ContentRail } from "../ContentRail"
import { FocusableCard } from "../FocusableCard"
import { CATEGORIES, type SearchCategory } from "./categories"

const POPULAR_COUNT = 8

type ListResult = ResultOf<typeof LIST_EXPERIENCES>
type Experience = NonNullable<NonNullable<ListResult["experiences"]>[number]>

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
  const { data } = useQuery(LIST_EXPERIENCES, { variables: { locale: "en" } })
  const experiences: Experience[] = useMemo(
    () =>
      (data?.experiences ?? [])
        .filter((e): e is Experience => e != null)
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
          <Text style={styles.railTitle}>Recent</Text>
          <RecentRow
            recents={recents}
            onRunQuery={onRunQuery}
            onClearHistory={onClearHistory}
          />
        </View>
      ) : null}

      <View style={styles.railContainer}>
        <Text style={styles.railTitle}>Browse topics</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRowContent}
        >
          {CATEGORIES.map((cat) => (
            <CategoryCard
              key={cat.searchTerm}
              category={cat}
              onPress={() => onRunQuery(cat.searchTerm)}
            />
          ))}
        </ScrollView>
      </View>

      {experiences.length > 0 ? (
        <ContentRail
          title="Popular experiences"
          railId="search-popular"
          data={experiences}
          keyExtractor={(item) => item.documentId}
          renderItem={(item, _index, hooks) => {
            const imageUrl = resolveImageUrl(item.ogImage?.url ?? null)
            return (
              <FocusableCard
                onPress={() => openExperience(item.slug)}
                onFocus={hooks.onFocus}
                style={styles.popularCard}
              >
                {imageUrl != null ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={styles.popularImage}
                    contentFit="cover"
                    recyclingKey={`popular-${item.documentId}`}
                  />
                ) : (
                  <View style={[styles.popularImage, styles.popularFallback]} />
                )}
                <View style={styles.popularText}>
                  <Text style={styles.popularTitle} numberOfLines={2}>
                    {item.title ?? "Untitled"}
                  </Text>
                </View>
              </FocusableCard>
            )
          }}
        />
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
        <FocusableCard
          key={`recent-${q}`}
          onPress={() => onRunQuery(q)}
          accessibilityLabel={`Recent search: ${q}`}
          style={styles.chip}
        >
          <View style={styles.chipInner}>
            <Text style={styles.chipText} numberOfLines={1}>
              {q}
            </Text>
          </View>
        </FocusableCard>
      ))}
      <FocusableCard
        onPress={onClearHistory}
        accessibilityLabel="Clear search history"
        style={styles.clearChip}
      >
        <View style={styles.chipInner}>
          <Text style={styles.clearText}>Clear</Text>
        </View>
      </FocusableCard>
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
    gap: scale(12),
    paddingVertical: scale(4),
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
    gap: scale(16),
    paddingVertical: scale(4),
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
    color: "#FFFFFF",
    textShadowColor: hexToRgba("#000000", 0.35),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
