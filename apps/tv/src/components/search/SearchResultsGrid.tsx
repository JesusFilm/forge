import { useRouter } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"

import type { View as ViewType } from "react-native"

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
   * Fixed column count override; the narrower two-pane results pane
   * uses fewer columns than the full-width default.
   */
  columns?: number
  /** Retry handler for the error state; parent wires useSemanticSearch.retry(). */
  onRetry?: () => void
  /**
   * D-pad-up destination for the grid's TOP ROW only. Stacked (Apple TV) layout
   * passes the keyboard's first-key node so up-escape lands on the keyboard. Omitted
   * in the two-pane layout, where up scrolls rows and left exits to the keyboard.
   */
  topRowFocusUp?: ViewType | null
}

/**
 * Window-width (dp) threshold for a 6-column grid. Reliable on Android TV
 * (logical width tracks pixels); Apple TV pins both 1080p and 4K at 4
 * columns via UIKit points, so verify on real 4K hardware before tuning.
 */
const SIX_COLUMN_THRESHOLD_DP = 2880

export function SearchResultsGrid({
  state,
  results,
  query,
  columns,
  onRetry,
  topRowFocusUp,
}: Props) {
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
    return (
      <ResultsList
        results={results}
        onPress={openResult}
        columns={columns}
        topRowFocusUp={topRowFocusUp}
      />
    )
  }

  // Compile-time exhaustiveness — a future SearchState variant
  // forces tsc to error here until the matching branch is added.
  const _exhaustive: never = state
  return _exhaustive
}

function ResultsList({
  results,
  onPress,
  columns,
  topRowFocusUp,
}: {
  results: SearchResult[]
  onPress: (result: SearchResult) => void
  columns?: number
  topRowFocusUp?: ViewType | null
}) {
  // Explicit `columns` wins (two-pane results pane); else width heuristic:
  // 6 columns on 4K-class panels, 4 elsewhere. numColumns is a static
  // FlatList hint — switching it forces a remount.
  const { width } = useWindowDimensions()
  const numColumns = columns ?? (width >= SIX_COLUMN_THRESHOLD_DP ? 6 : 4)

  // Claim first-cell focus only on the FIRST render of a given results set:
  // without this guard a debounced refresh re-passes hasTVPreferredFocus on
  // cell 0 and yanks focus back from wherever the user navigated (rn-tvos #839).
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

  // No focus traps: D-pad-left from the leftmost column must reach the
  // keyboard to refine the query. D-pad-right at the rightmost column has
  // nothing to land on; the focus engine leaves focus put without a trap.
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
        // Trim scroll-momentum tail on APPLE TV ONLY: tvOS swallows an along-axis move out
        // of a decelerating scroll view, so top-row D-pad-up can't reach the keyboard until
        // scroll settles (`topRowFocusUp` below guarantees it). Gated to ios. See docs/superpowers/specs/2026-06-22-tv-apple-linear-search-keyboard-design.md.
        decelerationRate={Platform.OS === "ios" ? "fast" : "normal"}
        renderItem={({ item, index }) => (
          // Per-cell wrapper gives the focus lift (translateY −8 + 1.06x)
          // breathing room; without it contentContainer clips the lifted card
          // at its edges. Same pattern as SearchBrowse / home's ContentRail.
          <View
            style={[
              styles.resultCellWrapper,
              { width: `${100 / numColumns}%` },
            ]}
          >
            <ResultCard
              result={item}
              onPress={onPress}
              // Claim focus only on the FIRST render of this results set;
              // later renders (debounced refresh, virtualization re-mount)
              // pass false to preserve the user's focus position.
              hasTVPreferredFocus={index === 0 && shouldClaimFirstCell}
              // TOP ROW only (index < numColumns): forces D-pad-up to the keyboard node
              // in the stacked layout. Coalesce null -> undefined so a not-yet-captured node
              // falls back to geometry; undefined elsewhere keeps intra-grid nav + left-exit.
              nextFocusUp={
                index < numColumns ? (topRowFocusUp ?? undefined) : undefined
              }
            />
          </View>
        )}
      />
    </TVFocusGuideView>
  )
}

/**
 * Retry button for the error state. Uses onFocus/onBlur + state, not the
 * `({ focused }) => [...]` callback: rn-tvos exposes `focused` at runtime but
 * upstream PressableStateCallbackType omits it, so the callback form fails tsc.
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
  // Pure presentation (design .s-empty, top-left aligned). No auto-focus-
  // return-to-⏎: its keyboard remount killed focus on the pressed letter on
  // every empty debounced result. Users keep typing; D-pad to leave.
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
    // Page gutter comes from screen padding + keyboard/pane gap, so this only
    // needs a small inset so edge cards' focus-lift rings aren't clipped (the
    // per-cell wrapper adds scale(14) more). Bottom is the run-out.
    paddingHorizontal: scale(14),
    paddingTop: scale(12),
    paddingBottom: scale(80),
  },
  row: {
    // No `gap` — resultCellWrapper.paddingHorizontal handles the
    // inter-card spacing AND the focus-lift headroom in one place.
    justifyContent: "flex-start",
  },
  resultCellWrapper: {
    // `width` is set inline as `${100/numColumns}%` (not flex:1) so a partial
    // last row's lone card stays 1/N width instead of stretching. Design gaps
    // 38px vertical / 28px horizontal → half on each side.
    paddingVertical: scale(19),
    paddingHorizontal: scale(14),
  },
})
