import { LinearGradient } from "expo-linear-gradient"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { FocusableCard } from "../FocusableCard"
import { CATEGORIES, type SearchCategory } from "./categories"
import { SEARCH_PAGE_GUTTER, SEARCH_THEME } from "./searchTheme"

type Props = {
  recents: string[]
  /** Called when the user presses a Recent chip or a Category card —
   *  parent sets the query to this value and fires an immediate search
   *  (bypassing the debounce). */
  onRunQuery: (query: string) => void
  /** Called when the user presses the "Clear" chip in the Recent rail. */
  onClearHistory: () => void
  /**
   * Break out of the parent's horizontal page padding so this view is
   * full-bleed. The rail title / chip / grid gutters below already encode the
   * 80dp page gutter, so once full-bleed the content lands exactly on the page
   * edges. The Apple TV stacked layout sets this (the browse view sits inside
   * the screen's scale(80) padding, which would otherwise double-inset it
   * relative to the full-width keyboard). The two-pane layout leaves it off —
   * there the browse view lives inside the narrower right pane.
   */
  fullBleed?: boolean
}

// The search-empty browse view: Recent searches + Browse-topics categories.
// Both are sourced locally / statically (recents from history, categories from
// the static CATEGORIES list), so this view needs no GraphQL query and works
// for the unauthenticated public app. (It previously showed a "Popular
// experiences" rail backed by the editor-gated Query.experiences, which 401'd
// for the public TV app and silently rendered empty — removed with the home's
// migration off that gated query.)
export function SearchBrowse({
  recents,
  onRunQuery,
  onClearHistory,
  fullBleed,
}: Props) {
  const showRecent = recents.length > 0

  return (
    <ScrollView
      style={[styles.scroll, fullBleed === true && styles.fullBleed]}
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
        {/* 3-column grid (not a horizontal carousel that ran off-screen): the
            categories wrap to rows of three, each card filling a third of the
            results pane. tvOS spatial navigation handles row/column D-pad moves
            by geometry; each cell's padding gives the focus glow + 1.05x lift
            room so the grid never clips it. */}
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((cat) => (
            <View
              key={`category-${cat.searchTerm}`}
              style={styles.categoryCellWrapper}
            >
              <CategoryCard
                category={cat}
                onPress={() => onRunQuery(cat.searchTerm)}
              />
            </View>
          ))}
        </View>
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
            focusRing="white"
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
          focusRing="white"
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
      focusRing="white"
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

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  // Cancels the parent screen's page padding so the view is full-bleed. Shares
  // SEARCH_PAGE_GUTTER with app/search.tsx styles.screen.paddingHorizontal so
  // the cancellation can't silently drift. The rail/chip/grid gutters then
  // place content on the page edges, matching the full-width keyboard above it
  // in the stacked (Apple TV) layout.
  fullBleed: {
    marginHorizontal: -scale(SEARCH_PAGE_GUTTER),
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
  // 3-column grid container. The 64dp side padding lines the first column up
  // with the rail titles' 80dp gutter (64 grid pad + 16 cell pad) — the same
  // left edge the carousel used.
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: scale(64),
  },
  // One third of the grid per cell → three columns. The padding is the
  // inter-card gap AND the focus-glow / 1.05x-lift breathing room
  // (shadowRadius scale(16)); RN's border-box width keeps three cells at
  // exactly 100%.
  categoryCellWrapper: {
    width: "33.333%",
    padding: scale(16),
  },
  // Fills its cell — roughly a third of the results pane, far larger than the
  // old fixed 220dp carousel card. A definite height (not aspectRatio) is what
  // sizes it: FocusableCard routes width/height to its outer layout box but
  // aspectRatio only to the inner, which can't size the box.
  categoryCard: {
    width: "100%",
    height: scale(210),
  },
  categoryGradient: {
    flex: 1,
    justifyContent: "flex-end",
    padding: scale(22),
  },
  categoryTitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(28)),
    fontWeight: "700",
    color: SEARCH_THEME.text,
    // Neutral near-black shadow — matches the redesigned search layer's
    // #0a0a0b family (the warm-stone Crimson Gallery tint clashed here).
    textShadowColor: "rgba(10,10,11,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
})
