import { useCallback, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { QueryDisplay } from "../src/components/search/QueryDisplay"
import { SearchKeyboard } from "../src/components/search/SearchKeyboard"
import { SearchResultsGrid } from "../src/components/search/SearchResultsGrid"
import { TVFocusGuideView } from "../src/components/TVFocusGuideView"
import { COLORS } from "../src/lib/colors"
import { scale } from "../src/lib/scale"
import { sanitizeQuery, useSemanticSearch } from "../src/lib/search"

/**
 * /search route — TV search surface.
 *
 * Two-pane layout:
 *   Left pane: QueryDisplay above SearchKeyboard.
 *   Right pane: placeholder today — U6 fills with SearchResultsGrid
 *   when the query is non-empty, U7 fills with SearchBrowse (Recent +
 *   Categories + Popular) when the query is empty.
 *
 * Owns `query` state and routes all writes through sanitizeQuery so
 * the backend never sees control chars, RTL overrides, or anything
 * beyond 256 chars. useSemanticSearch handles debounce, stale-guard,
 * and the state machine.
 *
 * See docs/plans/2026-04-24-001-feat-tv-search-ui-plan.md U4 + U5.
 */
export default function SearchScreen() {
  const [query, setQuery] = useState("")
  const [emptyStateFocusReturnKey, setEmptyStateFocusReturnKey] = useState(0)
  const { state, results, submit, retry } = useSemanticSearch(query)

  // Sanitize at the write site so downstream consumers never see raw
  // input. For the on-screen keyboard this is a no-op today (discrete
  // printable keys), but defense-in-depth for future input sources.
  const setSanitizedQuery = useCallback((next: string) => {
    setQuery(sanitizeQuery(next))
  }, [])

  // When the results grid enters "empty" state, bump a key so
  // SearchKeyboard re-mounts with submitKeyPreferredFocus claiming
  // focus on the ⏎ key — the user can edit-and-resubmit without
  // re-navigating the keyboard (doc-review P1 resolution).
  const handleEmptyState = useCallback(() => {
    setEmptyStateFocusReturnKey((k) => k + 1)
  }, [])

  const showResultsGrid = query.length > 0
  const submitKeyPreferredFocus =
    emptyStateFocusReturnKey > 0 && state === "empty"

  return (
    <View style={styles.screen}>
      <View style={styles.leftPane}>
        <QueryDisplay value={query} />
        <SearchKeyboard
          key={`search-keyboard-${emptyStateFocusReturnKey}`}
          value={query}
          onChange={setSanitizedQuery}
          onSubmit={submit}
          submitKeyPreferredFocus={submitKeyPreferredFocus}
        />
      </View>
      <TVFocusGuideView style={styles.rightPane} trapFocusLeft>
        {showResultsGrid ? (
          <SearchResultsGrid
            state={state}
            results={results}
            query={query}
            onEmpty={handleEmptyState}
            onRetry={retry}
          />
        ) : (
          // U7 fills this with Recent + Categories + Popular rails.
          <Text style={styles.rightStub}>
            Browse surface (Recent + Categories + Popular) — populated by U7.
          </Text>
        )}
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    paddingHorizontal: scale(48),
    paddingVertical: scale(48),
    gap: scale(32),
  },
  leftPane: {
    flexDirection: "column",
  },
  rightPane: {
    flex: 1,
    backgroundColor: COLORS.surfaceContainer,
    borderRadius: scale(16),
    padding: scale(32),
    justifyContent: "center",
  },
  rightStub: {
    fontFamily: "System",
    fontSize: scale(18),
    color: COLORS.muted,
    textAlign: "center",
  },
})
