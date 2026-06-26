import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native"

import { hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { FocusableCard } from "../FocusableCard"
import { CATEGORIES, type SearchCategory } from "./categories"
import { SEARCH_PAGE_GUTTER, SEARCH_THEME } from "./searchTheme"
import { useCategoryThumbnails } from "./useCategoryThumbnails"

// Soft scrim over the blurred thumbnail: short, low-opacity dark bands feathered
// at the top + bottom edges (bottom a touch stronger for title legibility) over a
// wide clear middle. hexToRgba(...,0) for clear stops, never "transparent".
const SCRIM_COLORS = [
  hexToRgba("#000000", 0.24),
  hexToRgba("#000000", 0.05),
  hexToRgba("#000000", 0),
  hexToRgba("#000000", 0),
  hexToRgba("#000000", 0.07),
  hexToRgba("#000000", 0.4),
] as const
const SCRIM_LOCATIONS = [0, 0.16, 0.32, 0.68, 0.84, 1] as const

// expo-image blurRadius isn't calibrated equally across platforms (the same
// value blurs harder on Android), so tvOS bumps up to match Android TV — mirrors
// apps/mobile's TopicCard.
const THUMBNAIL_BLUR_RADIUS = Platform.OS === "ios" ? 12 : 4

type Props = {
  recents: string[]
  /** Called when the user presses a Recent chip or a Category card —
   *  parent sets the query to this value and fires an immediate search
   *  (bypassing the debounce). */
  onRunQuery: (query: string) => void
  /** Called when the user presses the "Clear" chip in the Recent rail. */
  onClearHistory: () => void
  /**
   * Break out of the parent's horizontal page padding so this view is full-bleed
   * (the rail/chip/grid gutters below encode the 80dp gutter, landing content on
   * the page edges). Apple TV stacked layout sets this; two-pane leaves it off.
   */
  fullBleed?: boolean
}

// Search-empty browse view: Recent searches + Browse-topics (static CATEGORIES,
// each backed by a blurred thumbnail of its first search result). Works for the
// public app — only the anonymous `search` surface is used, no editor-gated query.
export function SearchBrowse({
  recents,
  onRunQuery,
  onClearHistory,
  fullBleed,
}: Props) {
  const showRecent = recents.length > 0
  const thumbnails = useCategoryThumbnails()

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
        {/* 3-column wrapping grid (not a carousel that ran off-screen). tvOS
            handles D-pad moves by geometry; each cell's padding gives the focus
            glow + 1.05x lift room so the grid never clips it. */}
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((cat) => (
            <View
              key={`category-${cat.searchTerm}`}
              style={styles.categoryCellWrapper}
            >
              <CategoryCard
                category={cat}
                onPress={() => onRunQuery(cat.searchTerm)}
                thumbnailUrl={thumbnails[cat.searchTerm]}
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
  thumbnailUrl,
}: {
  category: SearchCategory
  onPress: () => void
  thumbnailUrl?: string | null
}) {
  return (
    <FocusableCard
      onPress={onPress}
      accessibilityLabel={`${category.title} category`}
      accessibilityHint={`Searches for "${category.searchTerm}"`}
      focusRing="white"
      style={styles.categoryCard}
    >
      <View style={styles.categoryInner}>
        <LinearGradient
          colors={[
            hexToRgba(category.colors[0], 1),
            hexToRgba(category.colors[1], 1),
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Blurred art of the category's first search result, faint over the
            brand gradient. Absent until the limit:1 query resolves (and forever
            if none) so the gradient base keeps the card from ever being blank. */}
        {thumbnailUrl != null ? (
          <Image
            source={thumbnailUrl}
            style={[StyleSheet.absoluteFill, styles.categoryThumbnail]}
            contentFit="cover"
            blurRadius={THUMBNAIL_BLUR_RADIUS}
            transition={400}
            cachePolicy="memory-disk"
            recyclingKey={category.searchTerm}
          />
        ) : null}
        <LinearGradient
          colors={[...SCRIM_COLORS]}
          locations={[...SCRIM_LOCATIONS]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.categoryContent}>
          <Text style={styles.categoryTitle}>{category.title}</Text>
        </View>
      </View>
    </FocusableCard>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  // Cancels the parent screen's page padding for full-bleed. Shares
  // SEARCH_PAGE_GUTTER with app/search.tsx styles.screen.paddingHorizontal so
  // it can't drift; rail/chip/grid gutters then place content on the page edges.
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
    // Start/end gutter for the edge chips' focus glow inside the clip region;
    // inter-chip spacing is chipCellWrapper.paddingHorizontal. Sized so the
    // first chip's edge lands at the 80px page gutter (68 + 12).
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
  // One third per cell → three columns. Padding is the inter-card gap AND the
  // focus-glow / 1.05x-lift room; RN's border-box width keeps three cells at 100%.
  categoryCellWrapper: {
    width: "33.333%",
    padding: scale(16),
  },
  // Fills its cell. Needs a definite height (not aspectRatio): FocusableCard
  // routes width/height to its outer layout box but aspectRatio only to the
  // inner, which can't size the box.
  categoryCard: {
    width: "100%",
    height: scale(210),
  },
  categoryInner: {
    flex: 1,
  },
  // Faint over the brand gradient — mirrors mobile's 0.3 thumbnail opacity.
  categoryThumbnail: {
    opacity: 0.3,
  },
  categoryContent: {
    ...StyleSheet.absoluteFillObject,
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
