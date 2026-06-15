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
 * /search route — TV search surface, redesigned to the "Forge TV Home"
 * search-layer mockup.
 *
 * Vertical stack on a near-black full-bleed surface:
 *   Query line (big type + blinking caret)
 *   → horizontal letter strip (A–Z + space + delete + ⏎)
 *   → meta line (BROWSE / N RESULTS)
 *   → results region (SearchResultsGrid when the query is non-empty,
 *     SearchBrowse — Recent + Categories — when it's empty).
 *
 * Owns `query` state and routes all writes through sanitizeQuery so
 * the backend never sees control chars, RTL overrides, or anything
 * beyond 256 chars. useSemanticSearch handles debounce, stale-guard,
 * and the state machine.
 *
 * See docs/plans/2026-04-24-001-feat-tv-search-ui-plan.md U4 + U5 for
 * the data flow; the layout follows the Claude Design handoff.
 */
export default function SearchScreen() {
  const [query, setQuery] = useState("")
  const { state, results, lastSubmittedQuery, submit, runQuery, retry } =
    useSemanticSearch(query)
  const { recents, addRecent, clearAll } = useSearchHistory()

  // Sanitize at the write site so downstream consumers never see raw
  // input. For the on-screen keyboard this is a no-op today (discrete
  // printable keys), but defense-in-depth for future input sources.
  const setSanitizedQuery = useCallback((next: string) => {
    setQuery(sanitizeQuery(next))
  }, [])

  // Record successful non-empty searches in recent history once, when
  // the state first transitions to 'ready' with a non-empty result set
  // for the lastSubmittedQuery. Reading lastSubmittedQuery (the query
  // that drove these results) instead of the live `query` state means
  // the recorded entry matches what the user actually saw — typing
  // past the most-recent debounce-fired search no longer causes the
  // in-progress query to be persisted as if it had returned results.
  const lastRecordedQueryRef = useRef<string>("")
  useEffect(() => {
    if (state !== "ready") return
    if (results.length === 0) return
    if (lastSubmittedQuery.length === 0) return
    if (lastRecordedQueryRef.current === lastSubmittedQuery) return
    lastRecordedQueryRef.current = lastSubmittedQuery
    addRecent(lastSubmittedQuery)
  }, [state, results.length, lastSubmittedQuery, addRecent])

  // Recent / Category click runs a fresh search immediately, bypassing
  // the 600 ms debounce. Category search terms are hardcoded constants;
  // recent queries were already sanitized when first submitted. We
  // thread the sanitized value through runQuery directly because
  // submit() closes over the previous `query` state until React
  // commits the next render — the one-tick lag would otherwise fire a
  // search for the prior query, not the one the user just clicked.
  const runQueryImmediate = useCallback(
    (next: string) => {
      const sanitized = sanitizeQuery(next)
      setQuery(sanitized)
      runQuery(sanitized)
    },
    [runQuery],
  )

  const showResultsGrid = query.length > 0
  const meta = resolveSearchMeta(state, results.length, query.length > 0)

  return (
    <View style={styles.screen}>
      <View style={styles.queryLine}>
        <QueryDisplay value={query} />
      </View>
      {/* Two-pane body: keyboard on the left, results/browse filling the
          space to its right (rather than stacked below it, which left the
          right ~60% of the screen blank). */}
      <View style={styles.body}>
        {/* SearchKeyboard intentionally does not get a dynamic key:
            unmounting it on a state change kills focus on the
            currently-pressed letter, and the tvOS focus engine then
            visibly hops through a fallback before any new preferred-focus
            claim lands. Keep the keyboard mounted; let the user type
            without the rug being pulled. */}
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
              BROWSE / silence / N RESULTS never shifts the grid below. */}
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
  // Holds the one-line meta text at a stable height so the grid below
  // doesn't shift as the label changes (BROWSE / N RESULTS / empty).
  // Just tall enough for the 18px line — no extra reserved space, which
  // had opened a visible gap above the results.
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
