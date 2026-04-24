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
   * Called when the "empty" state renders so the parent screen can
   * return focus to the keyboard's ⏎ key (doc-review P1 resolution:
   * user edits-and-resubmits in one press instead of re-navigating
   * the keyboard from scratch).
   */
  onEmpty?: () => void
  /**
   * Called when the user presses the Retry button in the error or
   * degraded states. Parent wires this to useSemanticSearch.retry().
   */
  onRetry?: () => void
}

const NUM_COLUMNS = 4
const CARD_GAP = scale(20)

export function SearchResultsGrid({
  state,
  results,
  query,
  onEmpty,
  onRetry,
}: Props) {
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
    return <EmptyState query={query} onMount={onEmpty} />
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
  return (
    <TVFocusGuideView style={styles.listWrapper} trapFocusLeft trapFocusRight>
      <FlatList
        data={results}
        keyExtractor={(item) => `search-${item.type}-${item.id}`}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        renderItem={({ item, index }) => (
          <ResultCard
            result={item}
            onPress={onPress}
            // First result claims focus on render so the user's next
            // D-pad press navigates cleanly. This relies on the
            // keyboard-side focus having already yielded via onSubmit.
            hasTVPreferredFocus={index === 0}
          />
        )}
      />
    </TVFocusGuideView>
  )
}

function EmptyState({
  query,
  onMount,
}: {
  query: string
  onMount: (() => void) | undefined
}) {
  // Fire the focus-return callback synchronously so the keyboard's ⏎
  // key receives hasTVPreferredFocus before the next paint. Calling
  // on render is safe because the parent's callback just sets state;
  // React will batch the update.
  onMount?.()
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>No results for &ldquo;{query}&rdquo;</Text>
      <Text style={styles.messageDetail}>
        Try a different word or press the Search key to refine.
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
    gap: CARD_GAP,
  },
  row: {
    gap: CARD_GAP,
    justifyContent: "flex-start",
  },
})
