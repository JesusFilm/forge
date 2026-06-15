import { useRouter } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"

import { type SearchResult } from "../../lib/queries"
import { type SearchState } from "../../lib/search"
import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { ResultCard } from "./ResultCard"
import { searchResultPath } from "./searchResultPath"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  state: SearchState
  results: SearchResult[]
  query: string
  /**
   * Called when the user presses the Retry button in the error state.
   * Parent wires this to useSemanticSearch.retry().
   */
  onRetry?: () => void
}

/**
 * Window-width threshold (in dp) above which we render a 6-column
 * grid. Apple TV at 1080p reports ~1920dp logical window width and
 * 4K hardware reports the same logical width via UIKit's points API,
 * so this threshold is most reliable on Android TV (whose logical
 * width scales more closely with native pixels). On Apple TV, both
 * 1080p and 4K typically pin at 4 columns; verify on real 4K
 * hardware before tuning.
 */
const SIX_COLUMN_THRESHOLD_DP = 2880

export function SearchResultsGrid({ state, results, query, onRetry }: Props) {
  const router = useRouter()
  const openResult = useCallback(
    (result: SearchResult) => {
      router.push(searchResultPath(result))
    },
    [router],
  )

  if (state === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={WATCH_THEME.accent} />
      </View>
    )
  }

  if (state === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Search is temporarily unavailable.</Text>
        <RetryButton
          onPress={() => onRetry?.()}
          accessibilityHint="Re-runs your last search"
        />
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

  if (state === "ready") {
    return <ResultsList results={results} onPress={openResult} />
  }

  // Compile-time exhaustiveness — a future SearchState variant
  // forces tsc to error here until the matching branch is added.
  const _exhaustive: never = state
  return _exhaustive
}

function ResultsList({
  results,
  onPress,
}: {
  results: SearchResult[]
  onPress: (result: SearchResult) => void
}) {
  // 6 columns on wide panels (4K-class hardware reporting >SIX_COLUMN
  // _THRESHOLD_DP logical pixels), 4 elsewhere. FlatList's numColumns
  // prop is a static layout hint — switching it forces a remount, so
  // we read the value once per render and let React handle it.
  const { width } = useWindowDimensions()
  const numColumns = width >= SIX_COLUMN_THRESHOLD_DP ? 6 : 4

  // First-cell focus claim: only on the FIRST render that exposes a
  // given results set, not on every subsequent re-render. Without
  // this guard, a debounced response refresh while the user has
  // navigated to (say) result #5 would re-pass hasTVPreferredFocus
  // on cell 0 and yank focus back per rn-tvos #839.
  const firstResultKey =
    results.length > 0 ? `${results[0].type}-${results[0].id}` : null
  const claimedForKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (firstResultKey != null) {
      claimedForKeyRef.current = firstResultKey
    }
  }, [firstResultKey])
  const shouldClaimFirstCell =
    firstResultKey != null && claimedForKeyRef.current !== firstResultKey

  // No focus traps: D-pad-left from the leftmost column must reach
  // the keyboard so the user can refine the query without re-entering
  // the screen. D-pad-right at the rightmost column simply has nothing
  // to land on; the focus engine leaves focus put without a trap.
  return (
    <TVFocusGuideView style={styles.listWrapper}>
      <FlatList
        // The key forces FlatList to re-mount cleanly when numColumns
        // changes (rotation / display swap on Android TV). Without it
        // RN warns about numColumns changes mid-flight.
        key={`grid-${numColumns}`}
        data={results}
        keyExtractor={(item) => `search-${item.type}-${item.id}`}
        numColumns={numColumns}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        renderItem={({ item, index }) => (
          // Per-cell wrapper provides the breathing room the focus
          // lift needs (translateY −8 + 1.06x scale on the ResultCard).
          // Without this, the FlatList's contentContainer clips the
          // lifted card at its outer edges. Same pattern as SearchBrowse
          // and home's ContentRail itemWrapper.
          <View
            style={[
              styles.resultCellWrapper,
              { width: `${100 / numColumns}%` },
            ]}
          >
            <ResultCard
              result={item}
              onPress={onPress}
              // First result claims focus only on the FIRST render
              // that exposes this results set; subsequent renders
              // (debounced response refresh, virtualization re-mount)
              // pass false so the user's current focus position is
              // preserved.
              hasTVPreferredFocus={index === 0 && shouldClaimFirstCell}
            />
          </View>
        )}
      />
    </TVFocusGuideView>
  )
}

/**
 * Retry button for the error state. Uses the
 * onFocus / onBlur + state pattern (matching the home screen's retry
 * button) rather than the `({ focused }) => [...]` style callback —
 * `focused` is exposed at runtime by react-native-tvos but not by
 * the upstream PressableStateCallbackType, so the callback form
 * fails CI's strict tsc check.
 */
function RetryButton({
  onPress,
  accessibilityHint,
}: {
  onPress: () => void
  accessibilityHint: string
}) {
  const [isFocused, setIsFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Try again"
      accessibilityHint={accessibilityHint}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={[styles.retryButton, isFocused && styles.retryButtonFocused]}
      onPress={onPress}
    >
      <Text style={styles.retryText}>Try again</Text>
    </Pressable>
  )
}

function EmptyState({ query }: { query: string }) {
  // Pure presentation (design: .s-empty — top-left aligned, not
  // centered). The earlier auto-focus-return-to-⏎ behavior was removed
  // because it actively fought typing — the keyboard remount it required
  // killed focus on the currently-pressed letter every time a debounced
  // search came back empty. Users keep typing on the keyboard; if they
  // want to navigate away, they D-pad explicitly.
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>
        No results for &ldquo;{query}&rdquo;
      </Text>
      <Text style={styles.emptyDetail}>
        Check the spelling, or try a shorter search.
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
    fontSize: Math.round(scale(22)),
    fontWeight: "600",
    color: SEARCH_THEME.text,
    textAlign: "center",
  },
  // Design .s-empty: top-left aligned at 60px vertical / 80px horizontal.
  empty: {
    paddingVertical: scale(60),
    paddingHorizontal: scale(80),
  },
  emptyTitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(32)),
    fontWeight: "700",
    letterSpacing: scale(-0.4),
    color: SEARCH_THEME.text,
  },
  emptyDetail: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    color: SEARCH_THEME.textDim(0.5),
    marginTop: scale(10),
  },
  retryButton: {
    marginTop: scale(16),
    paddingHorizontal: scale(32),
    paddingVertical: scale(14),
    borderRadius: scale(24),
    backgroundColor: WATCH_THEME.accent,
  },
  retryButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: WATCH_THEME.accent,
    shadowRadius: scale(20),
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
  retryText: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "600",
    color: WATCH_THEME.accentText,
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    // Page gutter: design grid padding is 80px; the per-cell wrapper
    // carries scale(14) of it (half the 28px inter-card gap), so the
    // contentContainer supplies the remaining scale(66). Top padding is
    // small — the meta line above already provides the vertical rhythm —
    // and the bottom matches the design's 80px run-out.
    paddingHorizontal: scale(66),
    paddingTop: scale(12),
    paddingBottom: scale(80),
  },
  row: {
    // No `gap` — resultCellWrapper.paddingHorizontal handles the
    // inter-card spacing AND the focus-lift headroom in one place.
    justifyContent: "flex-start",
  },
  resultCellWrapper: {
    // `width` is set inline at render time as `${100/numColumns}%` so
    // 4-column or 6-column layouts both fill the row edge-to-edge
    // with equal left/right gutters. Using a percentage (rather than
    // `flex: 1`) keeps a partial last row's lone card from stretching
    // — it stays at 1/N width regardless of how many siblings exist.
    // Design gaps: 38px vertical / 28px horizontal → half on each side.
    paddingVertical: scale(19),
    paddingHorizontal: scale(14),
  },
})
