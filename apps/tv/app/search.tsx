import { useCallback, useEffect, useRef, useState } from "react"
import { Platform, StyleSheet, Text, View } from "react-native"

import { QueryDisplay } from "../src/components/search/QueryDisplay"
import { SearchBrowse } from "../src/components/search/SearchBrowse"
import { resolveSearchMeta } from "../src/components/search/searchDisplay"
import { SearchKeyboard } from "../src/components/search/SearchKeyboard"
import { SearchKeyboardLinear } from "../src/components/search/SearchKeyboardLinear"
import { SearchResultsGrid } from "../src/components/search/SearchResultsGrid"
import { SEARCH_THEME } from "../src/components/search/searchTheme"
import { TVFocusGuideView } from "../src/components/TVFocusGuideView"
import { scale } from "../src/lib/scale"
import type { SearchResult } from "../src/lib/queries"
import type { SearchState } from "../src/lib/search"
import { sanitizeQuery, useSemanticSearch } from "../src/lib/search"
import { useSearchHistory } from "../src/lib/searchHistory"

/**
 * /search route — TV search surface, redesigned to the "Forge TV Home"
 * search-layer mockup. The layout varies by TV platform:
 *
 *   - Apple TV (Platform.OS === "ios"): a single-line keyboard at the top
 *     (SearchKeyboardLinear) with results stacked full-width below it — the
 *     native tvOS "swipe along the line" search idiom.
 *   - Android TV (Platform.OS === "android"): the grid keyboard on the left
 *     (SearchKeyboard) with results in a narrower pane on the right.
 *
 * Both share the query line (big type + blinking caret) at the top and the
 * results region (SearchResultsGrid when the query is non-empty, SearchBrowse —
 * Recent + Categories — when it's empty).
 *
 * SearchScreen owns `query` state and routes all writes through sanitizeQuery so
 * the backend never sees control chars, RTL overrides, or anything beyond 256
 * chars. useSemanticSearch handles debounce, stale-guard, and the state machine.
 *
 * The native tvOS UISearchController is intentionally NOT used: a real-device
 * spike (2026-06-22) proved react-native-screens headerSearchBarOptions crashes
 * on tvOS at mount. See docs/superpowers/specs/2026-06-22-tv-apple-linear-search-keyboard-design.md.
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

  // Trim so a whitespace-only query falls back to SearchBrowse rather than an
  // empty results pane — matching useSemanticSearch, which gates its fetch on
  // the trimmed length. (Not reachable via the on-screen keyboard today, but
  // defensive for future input sources and keeps the two gates in lockstep.)
  const hasQuery = query.trim().length > 0
  const meta = resolveSearchMeta(state, results.length)

  const bodyProps: SearchBodyProps = {
    query,
    state,
    results,
    meta,
    hasQuery,
    onChangeQuery: setSanitizedQuery,
    onSubmit: submit,
    onRunQuery: runQueryImmediate,
    onClearHistory: clearAll,
    recents,
    onRetry: retry,
  }

  return (
    <View style={styles.screen}>
      <View style={styles.queryLine}>
        <QueryDisplay value={query} />
      </View>
      {Platform.OS === "ios" ? (
        <SearchBodyStacked {...bodyProps} />
      ) : (
        <SearchBodyTwoPane {...bodyProps} />
      )}
    </View>
  )
}

type SearchBodyProps = {
  query: string
  state: SearchState
  results: SearchResult[]
  meta: string
  hasQuery: boolean
  onChangeQuery: (next: string) => void
  onSubmit: () => void
  onRunQuery: (next: string) => void
  onClearHistory: () => void
  recents: string[]
  onRetry: () => void
}

/**
 * Meta line + results region, shared by both bodies. Renders the results grid
 * when there is a query, else the idle browse grid. `columns` is forwarded to
 * SearchResultsGrid (the two-pane layout passes a fixed count for its narrower
 * pane; the stacked layout omits it to use the responsive full-width default).
 */
function SearchResultsPane({
  state,
  results,
  query,
  meta,
  hasQuery,
  recents,
  onRunQuery,
  onClearHistory,
  onRetry,
  columns,
}: SearchBodyProps & { columns?: number }) {
  return (
    <>
      <View style={styles.metaLine}>
        <Text style={styles.metaText}>{meta}</Text>
      </View>
      <TVFocusGuideView style={styles.resultsRegion}>
        {hasQuery ? (
          <SearchResultsGrid
            state={state}
            results={results}
            query={query}
            columns={columns}
            onRetry={onRetry}
          />
        ) : (
          <SearchBrowse
            recents={recents}
            onRunQuery={onRunQuery}
            onClearHistory={onClearHistory}
          />
        )}
      </TVFocusGuideView>
    </>
  )
}

/**
 * Android TV body: grid keyboard on the left, results pane on the right.
 * D-pad-left from the grid's leftmost column reaches the keyboard by geometry.
 */
function SearchBodyTwoPane(props: SearchBodyProps) {
  return (
    <View style={styles.twoPaneBody}>
      {/* SearchKeyboard intentionally is not remounted on state changes:
          unmounting it kills focus on the currently-pressed letter and the
          tvOS focus engine then hops through a fallback. Keep it mounted. */}
      <View style={styles.keyboardPane}>
        <SearchKeyboard
          value={props.query}
          onChange={props.onChangeQuery}
          onSubmit={props.onSubmit}
        />
      </View>
      <View style={styles.resultsPane}>
        <SearchResultsPane {...props} columns={TWO_PANE_RESULTS_COLUMNS} />
      </View>
    </View>
  )
}

/**
 * Apple TV body: single-line keyboard on top, results stacked full-width below.
 * `columns` is omitted so SearchResultsGrid uses its responsive full-width
 * default (4 columns at ≤2880dp, 6 above). Down from the keyboard drops into
 * the results region (the keyboard does not trap focus downward).
 */
function SearchBodyStacked(props: SearchBodyProps) {
  return (
    <View style={styles.stackedBody}>
      {/* Like SearchKeyboard in the two-pane body, SearchKeyboardLinear is not
          given a dynamic React key: remounting it on a query/state change kills
          focus on the currently-pressed key. Keep it mounted. */}
      <SearchKeyboardLinear
        value={props.query}
        onChange={props.onChangeQuery}
        onSubmit={props.onSubmit}
      />
      <SearchResultsPane {...props} />
    </View>
  )
}

// Android two-pane: the keyboard takes the left third, so 3 columns keeps
// result cards a comfortable 10-foot size in the narrower right pane.
const TWO_PANE_RESULTS_COLUMNS = 3

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
  // Android: keyboard (left) + results (right) fill the height side by side.
  twoPaneBody: {
    flex: 1,
    flexDirection: "row",
    gap: scale(56),
    paddingTop: scale(14),
  },
  // Apple TV: single-line keyboard on top, results filling the space below.
  stackedBody: {
    flex: 1,
    paddingTop: scale(14),
    gap: scale(14),
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
  // doesn't shift as the label changes (N RESULTS / empty while browsing).
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
