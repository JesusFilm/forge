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
        <RetryButton
          onPress={() => onRetry?.()}
          accessibilityHint="Re-runs your last search"
        />
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
            Search is running in limited mode: results may be incomplete.
          </Text>
          <RetryButton
            onPress={() => onRetry?.()}
            accessibilityHint="Re-runs your last search; may recover full results if the embedding service is back"
          />
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
          // glow needs (shadowRadius scale(16) + 1.05x scale on the
          // FocusableCard ≈ 21dp halo). Without this, the FlatList's
          // contentContainer clips the glow at its outer edges. Same
          // pattern as SearchBrowse and home's ContentRail itemWrapper.
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
 * Retry button shared by the error and degraded states. Uses the
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
    // Outer breathing room between the grid and the right-pane edges.
    // Sized so the focus glow (shadowRadius scale(16) + 1.05x scale ≈
    // 21dp halo) lands cleanly on dark panel surface with visible
    // gutter on every side, not against the panel's rounded corner or
    // outer border. Bumped twice — the original scale(16) clipped the
    // glow on the leftmost / rightmost columns, scale(32) still let it
    // touch the corner radius on a focused first-row card, scale(48)
    // gives the bloom a clear margin on all four sides.
    paddingHorizontal: scale(48),
    paddingVertical: scale(28),
  },
  row: {
    // No `gap` — resultCellWrapper.paddingHorizontal handles the
    // inter-card spacing AND the focus halo headroom in one place.
    justifyContent: "flex-start",
  },
  resultCellWrapper: {
    // `width` is set inline at render time as `${100/numColumns}%` so
    // 4-column or 6-column layouts both fill the row edge-to-edge
    // with equal left/right gutters. Using a percentage (rather than
    // `flex: 1`) keeps a partial last row's lone card from stretching
    // — it stays at 1/N width regardless of how many siblings exist.
    paddingVertical: scale(14),
    paddingHorizontal: scale(14),
  },
})
