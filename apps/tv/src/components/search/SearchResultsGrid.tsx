import { useRouter } from "expo-router"
import { useCallback } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { type SearchResult } from "../../lib/queries"
import { type SearchState } from "../../lib/search"
import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { ResultCard } from "./ResultCard"

type Props = {
  state: SearchState
  results: SearchResult[]
  query: string
  /**
   * Called when the user presses the Retry button in the error or
   * degraded states. Parent wires this to useSemanticSearch.retry().
   */
  onRetry?: () => void
}

const NUM_COLUMNS = 4

export function SearchResultsGrid({ state, results, query, onRetry }: Props) {
  const router = useRouter()
  const openResult = useCallback(
    (result: SearchResult) => {
      router.push(`/experience/${encodeURIComponent(result.slug)}`)
    },
    [router],
  )

  if (state === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    )
  }

  if (state === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Search is temporarily unavailable.</Text>
        <Text style={styles.messageDetail}>Please try again.</Text>
        <Pressable
          style={({ focused }) => [
            styles.retryButton,
            focused && styles.retryButtonFocused,
          ]}
          onPress={() => onRetry?.()}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    )
  }

  if (state === "degraded") {
    // Distinct UX from "empty" — the backend degraded signal (searchMode
    // === "keyword-only") means the embedding service is unavailable
    // and results may be incomplete. We still render what came back so
    // the user has something, but we label it clearly.
    return (
      <View style={styles.degradedContainer}>
        <View style={styles.degradedBanner}>
          <Text style={styles.degradedText}>
            Search is running in limited mode — results may be incomplete.
          </Text>
          <Pressable
            style={({ focused }) => [
              styles.retryButton,
              focused && styles.retryButtonFocused,
            ]}
            onPress={() => onRetry?.()}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
        {results.length > 0 ? (
          <ResultsList results={results} onPress={openResult} />
        ) : (
          <Text style={styles.messageDetail}>No results available.</Text>
        )}
      </View>
    )
  }

  if (state === "empty") {
    return <EmptyState query={query} />
  }

  if (state === "idle") {
    // /search renders SearchBrowse (U7) in this branch — the grid is
    // only visible once a query is non-empty. Return null as a defensive
    // fallback in case a caller renders the grid in idle state directly.
    return null
  }

  // state === "ready"
  return <ResultsList results={results} onPress={openResult} />
}

function ResultsList({
  results,
  onPress,
}: {
  results: SearchResult[]
  onPress: (result: SearchResult) => void
}) {
  // No focus traps: D-pad-left from the leftmost column must reach
  // the keyboard so the user can refine the query without re-entering
  // the screen. D-pad-right at the rightmost column simply has nothing
  // to land on; the focus engine leaves focus put without a trap.
  return (
    <TVFocusGuideView style={styles.listWrapper}>
      <FlatList
        data={results}
        keyExtractor={(item) => `search-${item.type}-${item.id}`}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        renderItem={({ item, index }) => (
          // Per-cell wrapper provides the breathing room the focus
          // glow needs (shadowRadius scale(16) + 1.05x scale on the
          // FocusableCard ≈ 21dp halo). Without this, the FlatList's
          // contentContainer clips the glow at its outer edges. Same
          // pattern as SearchBrowse and home's ContentRail itemWrapper.
          <View style={styles.resultCellWrapper}>
            <ResultCard
              result={item}
              onPress={onPress}
              // First result claims focus on render so the user's next
              // D-pad press navigates cleanly. This relies on the
              // keyboard-side focus having already yielded via onSubmit.
              hasTVPreferredFocus={index === 0}
            />
          </View>
        )}
      />
    </TVFocusGuideView>
  )
}

function EmptyState({ query }: { query: string }) {
  // Pure presentation. The earlier auto-focus-return-to-⏎ behavior
  // was removed because it actively fought typing — the keyboard
  // remount it required killed focus on the currently-pressed letter
  // every time a debounced search came back empty. Users keep typing
  // on the keyboard; if they want to navigate away, they D-pad
  // explicitly.
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>No results for &ldquo;{query}&rdquo;</Text>
      <Text style={styles.messageDetail}>
        Try a different word or backspace to refine.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: scale(12),
  },
  message: {
    fontFamily: "System",
    fontSize: scale(22),
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
  },
  messageDetail: {
    fontFamily: "System",
    fontSize: scale(16),
    color: COLORS.muted,
    textAlign: "center",
  },
  retryButton: {
    marginTop: scale(16),
    paddingHorizontal: scale(32),
    paddingVertical: scale(14),
    borderRadius: scale(24),
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
    fontSize: scale(18),
    fontWeight: "600",
    color: COLORS.text,
  },
  degradedContainer: {
    flex: 1,
    gap: scale(16),
  },
  degradedBanner: {
    backgroundColor: COLORS.surfaceContainerHigh,
    padding: scale(16),
    borderRadius: scale(12),
    gap: scale(8),
    alignItems: "center",
  },
  degradedText: {
    fontFamily: "System",
    fontSize: scale(14),
    color: COLORS.muted,
    textAlign: "center",
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    // Start/end gutter so the top-row / bottom-row card focus glow
    // is not clipped against the FlatList contentContainer edge.
    // Inter-row vertical spacing comes from resultCellWrapper.
    paddingHorizontal: scale(16),
    paddingVertical: scale(8),
  },
  row: {
    // No `gap` — resultCellWrapper.paddingHorizontal handles the
    // inter-card spacing AND the focus halo headroom in one place.
    justifyContent: "flex-start",
  },
  resultCellWrapper: {
    // Each cell claims exactly 1/N of the row width so the grid fills
    // the panel edge-to-edge with equal left/right gutters. Using a
    // percentage (rather than `flex: 1`) keeps a partial last row's
    // single card from stretching to the full row — it stays at the
    // same width as cells in fully-populated rows.
    width: `${100 / NUM_COLUMNS}%`,
    // Vertical: tightened from scale(28) on request — gives a denser
    // grid rhythm. Glow halo (shadowRadius scale(16) + ~5dp scale
    // expansion ≈ 21dp) gets trimmed by ~7dp at top/bottom corners
    // of focused cards in worst case; that's the trade we accepted
    // for tighter row spacing. Inter-row visual gap = 2 × scale(14)
    // = 28dp (was 56dp).
    paddingVertical: scale(14),
    // Horizontal: 14dp on each side gives 28dp between adjacent cards
    // in the same row. The 16dp shadow can blend into the neighbour's
    // halo — fine, only the focused card glows at any time.
    paddingHorizontal: scale(14),
  },
})
