import { useCallback, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { QueryDisplay } from "../src/components/search/QueryDisplay"
import { SearchKeyboard } from "../src/components/search/SearchKeyboard"
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
  const { state, results, submit } = useSemanticSearch(query)

  // Sanitize at the write site so downstream consumers never see raw
  // input. For the on-screen keyboard this is a no-op today (discrete
  // printable keys), but defense-in-depth for future input sources.
  const setSanitizedQuery = useCallback((next: string) => {
    setQuery(sanitizeQuery(next))
  }, [])

  return (
    <View style={styles.screen}>
      <View style={styles.leftPane}>
        <QueryDisplay value={query} />
        <SearchKeyboard
          value={query}
          onChange={setSanitizedQuery}
          onSubmit={submit}
        />
      </View>
      <TVFocusGuideView style={styles.rightPane} trapFocusLeft>
        {/* Right pane is populated by U6 (SearchResultsGrid) and U7
            (SearchBrowse) in later units. State + results wiring is
            already in place so U6 / U7 drop in without re-threading. */}
        <Text style={styles.rightStub}>
          {query.length === 0
            ? "Browse surface (Recent + Categories + Popular) — populated by U7."
            : `Search state: "${state}" for "${query}" (${results.length} result${results.length === 1 ? "" : "s"}) — grid populated by U6.`}
        </Text>
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
