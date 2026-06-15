import { LinearGradient } from "expo-linear-gradient"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { FocusableCard } from "../FocusableCard"
import { CATEGORIES, type SearchCategory } from "./categories"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  recents: string[]
  /** Called when the user presses a Recent chip or a Category card —
   *  parent sets the query to this value and fires an immediate search
   *  (bypassing the debounce). */
  onRunQuery: (query: string) => void
  /** Called when the user presses the "Clear" chip in the Recent rail. */
  onClearHistory: () => void
}

// The search-empty browse view: Recent searches + Browse-topics categories.
// Both are sourced locally / statically (recents from history, categories from
// the static CATEGORIES list), so this view needs no GraphQL query and works
// for the unauthenticated public app. (It previously showed a "Popular
// experiences" rail backed by the editor-gated Query.experiences, which 401'd
// for the public TV app and silently rendered empty — removed with the home's
// migration off that gated query.)
export function SearchBrowse({ recents, onRunQuery, onClearHistory }: Props) {
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
    color: SEARCH_THEME.textDim(0.45),
    letterSpacing: 0.5,
    marginBottom: scale(10),
    // The browse region is full-bleed on the redesigned layout; align
    // the rail headers with the page's 80px gutter (the rows below add
    // their own start padding inside their ScrollViews).
    marginLeft: scale(80),
  },
  chipRowContent: {
    // Start/end gutter so the leftmost / rightmost chip has room for
    // its focus glow inside the ScrollView's clip region. Inter-chip
    // spacing comes from chipCellWrapper.paddingHorizontal — see
    // categoryCellWrapper for the same pattern's rationale. Sized so
    // the first chip's edge lands at the 80px page gutter (68 + 12).
    paddingHorizontal: scale(68),
  },
  chipCellWrapper: {
    paddingVertical: scale(28),
    paddingHorizontal: scale(12),
  },
  chip: {
    backgroundColor: SEARCH_THEME.keyBg,
    paddingHorizontal: scale(16),
    paddingVertical: scale(10),
  },
  clearChip: {
    backgroundColor: SEARCH_THEME.textDim(0.04),
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
    color: SEARCH_THEME.keyText,
    maxWidth: scale(160),
  },
  clearText: {
    fontFamily: "System",
    fontSize: scale(14),
    fontWeight: "500",
    color: SEARCH_THEME.textDim(0.45),
  },
  categoryRowContent: {
    // Start/end gutter so the leftmost / rightmost card's focus glow
    // is not clipped against the ScrollView's contentContainer edge.
    // Inter-card spacing comes from categoryCellWrapper.paddingHorizontal
    // (so each card carries its own focus halo padding instead of
    // relying on `gap`, which doesn't reserve glow room). Sized so the
    // first card's edge lands at the 80px page gutter (64 + 16).
    paddingHorizontal: scale(64),
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
    color: SEARCH_THEME.text,
    // Neutral near-black shadow — matches the redesigned search layer's
    // #0a0a0b family (the warm-stone Crimson Gallery tint clashed here).
    textShadowColor: "rgba(10,10,11,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
})
