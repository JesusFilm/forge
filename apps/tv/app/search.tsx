import { useCallback, useEffect, useRef, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { QueryDisplay } from "../src/components/search/QueryDisplay"
import { SearchBrowse } from "../src/components/search/SearchBrowse"
import { resolveSearchMeta } from "../src/components/search/searchDisplay"
import { SearchKeyboard } from "../src/components/search/SearchKeyboard"
import { SearchResultsGrid } from "../src/components/search/SearchResultsGrid"
import { SEARCH_THEME } from "../src/components/search/searchTheme"
import { TVFocusGuideView } from "../src/components/TVFocusGuideView"
import { scale } from "../src/lib/scale"
import { sanitizeQuery, useSemanticSearch } from "../src/lib/search"
import { useSearchHistory } from "../src/lib/searchHistory"

/**
 * /search route — TV search surface (query line → letter strip → meta line →
 * results region; SearchResultsGrid when query non-empty, else SearchBrowse).
 * Owns `query`, routing all writes through sanitizeQuery so the backend never
 * sees control chars / RTL overrides / >256 chars. useSemanticSearch handles
 * debounce, stale-guard, and the state machine.
 * See docs/plans/2026-04-24-001-feat-tv-search-ui-plan.md U4 + U5.
 */
export default function SearchScreen() {
  const [query, setQuery] = useState("")
  const { state, results, lastSubmittedQuery, submit, runQuery, retry } =
    useSemanticSearch(query)
  const { recents, addRecent, clearAll } = useSearchHistory()

  // Sanitize at the write site so downstream consumers never see raw input.
  // No-op for the on-screen keyboard today; defense-in-depth for future sources.
  const setSanitizedQuery = useCallback((next: string) => {
    setQuery(sanitizeQuery(next))
  }, [])

  // Record a successful non-empty search in recents once, on first 'ready' with
  // results. Keying on lastSubmittedQuery (not live `query`) matches what the user
  // saw — typing past the last debounced search won't persist the in-progress query.
  const lastRecordedQueryRef = useRef<string>("")
  useEffect(() => {
    if (state !== "ready") return
    if (results.length === 0) return
    if (lastSubmittedQuery.length === 0) return
    if (lastRecordedQueryRef.current === lastSubmittedQuery) return
    lastRecordedQueryRef.current = lastSubmittedQuery
    addRecent(lastSubmittedQuery)
  }, [state, results.length, lastSubmittedQuery, addRecent])

  // Recent / Category click runs a fresh search immediately, bypassing the 600ms
  // debounce. Thread the sanitized value through runQuery directly: submit() closes
  // over stale `query` until the next render, so the lag would search the prior one.
  const runQueryImmediate = useCallback(
    (next: string) => {
      const sanitized = sanitizeQuery(next)
      setQuery(sanitized)
      runQuery(sanitized)
    },
    [runQuery],
  )

  // Trim so a whitespace-only query falls back to SearchBrowse, not an empty
  // pane — matching useSemanticSearch's trimmed-length fetch gate (keeps the two
  // gates in lockstep; defensive for future input sources).
  const hasQuery = query.trim().length > 0
  const showResultsGrid = hasQuery
  const meta = resolveSearchMeta(state, results.length)

  return (
    <View style={styles.screen}>
      <View style={styles.queryLine}>
        <QueryDisplay value={query} />
      </View>
      {/* Two-pane body: keyboard on the left, results/browse filling the
          space to its right (rather than stacked below it, which left the
          right ~60% of the screen blank). */}
      <View style={styles.body}>
        {/* No dynamic key on SearchKeyboard: remounting it on state change kills
            focus on the pressed letter, and tvOS then visibly hops through a
            fallback before any new preferred-focus claim lands. Keep it mounted. */}
        <View style={styles.keyboardPane}>
          <SearchKeyboard
            value={query}
            onChange={setSanitizedQuery}
            onSubmit={submit}
          />
        </View>
        {/* Right pane: meta line + results. D-pad-left from the grid's
            leftmost column reaches the keyboard (to its left) by geometry;
            no focus traps needed. */}
        <View style={styles.resultsPane}>
          {/* Fixed-height meta line (design .s-meta) so flipping between
              silence (browsing) and N RESULTS never shifts the grid below. */}
          <View style={styles.metaLine}>
            <Text style={styles.metaText}>{meta}</Text>
          </View>
          <TVFocusGuideView style={styles.resultsRegion}>
            {showResultsGrid ? (
              <SearchResultsGrid
                state={state}
                results={results}
                query={query}
                columns={RESULTS_COLUMNS}
                onRetry={retry}
              />
            ) : (
              <SearchBrowse
                recents={recents}
                onRunQuery={runQueryImmediate}
                onClearHistory={clearAll}
              />
            )}
          </TVFocusGuideView>
        </View>
      </View>
    </View>
  )
}

// The results pane is narrower than the full screen (the keyboard takes the
// left third), so 3 columns keeps result cards a comfortable 10-foot size
// rather than the 4 a full-width grid would pack in.
const RESULTS_COLUMNS = 3

const styles = StyleSheet.create({
  // Full-bleed near-black surface — solid stand-in for the design's
  // blur-over-home search layer. One horizontal pad for the whole screen;
  // panes below align to it.
  screen: {
    flex: 1,
    backgroundColor: SEARCH_THEME.bg,
    paddingHorizontal: scale(80),
  },
  // Design .s-query: padding 78px 0 (horizontal comes from screen).
  queryLine: {
    paddingTop: scale(78),
  },
  // Keyboard (left) + results (right) fill the remaining height side by side.
  body: {
    flex: 1,
    flexDirection: "row",
    gap: scale(56),
    paddingTop: scale(14),
  },
  // Left column sized to the keyboard's intrinsic width (it is
  // alignItems:flex-start internally).
  keyboardPane: {
    alignSelf: "flex-start",
  },
  // Right column takes the rest of the width.
  resultsPane: {
    flex: 1,
  },
  // Stable height for the one-line meta text so the grid doesn't shift as the
  // label changes (N RESULTS / empty). Just tall enough for the 18px line —
  // extra reserved space had opened a visible gap above the results.
  metaLine: {
    minHeight: scale(30),
  },
  metaText: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "700",
    letterSpacing: scale(2.9),
    color: SEARCH_THEME.textDim(0.45),
  },
  // Fills the remainder of the right pane. Minimal headroom — the grid's
  // top row carries its own focus-lift padding, so a large inset here just
  // widens the gap below the meta line.
  resultsRegion: {
    flex: 1,
    paddingTop: scale(2),
  },
})
