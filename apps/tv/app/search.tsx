import { useCallback, useEffect, useRef, useState } from "react"
import { Platform, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"

import { QueryDisplay } from "../src/components/search/QueryDisplay"
import { SearchBrowse } from "../src/components/search/SearchBrowse"
import { resolveSearchMeta } from "../src/components/search/searchDisplay"
import { SearchKeyboard } from "../src/components/search/SearchKeyboard"
import { SearchKeyboardLinear } from "../src/components/search/SearchKeyboardLinear"
import { SearchResultsGrid } from "../src/components/search/SearchResultsGrid"
import {
  SEARCH_PAGE_GUTTER,
  SEARCH_THEME,
} from "../src/components/search/searchTheme"
import { TVFocusGuideView } from "../src/components/TVFocusGuideView"
import { scale } from "../src/lib/scale"
import type { SearchResult } from "../src/lib/queries"
import type { SearchState } from "../src/lib/search"
import { sanitizeQuery, useSemanticSearch } from "../src/lib/search"
import { useSearchHistory } from "../src/lib/searchHistory"

/**
 * /search route — Apple TV (Platform.OS "ios") = top linear keyboard + full-width
 * results; Android TV = left grid keyboard + right pane. Native tvOS UISearchController
 * NOT used (2026-06-22 spike: crashes at mount). See docs/superpowers/specs/2026-06-22-tv-apple-linear-search-keyboard-design.md.
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
 * SearchResultsGrid (two-pane passes a fixed count; stacked omits it for full-width).
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
  topRowFocusUp,
  browseFullBleed,
}: SearchBodyProps & {
  columns?: number
  topRowFocusUp?: ViewType | null
  browseFullBleed?: boolean
}) {
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
            topRowFocusUp={topRowFocusUp}
          />
        ) : (
          <SearchBrowse
            recents={recents}
            onRunQuery={onRunQuery}
            onClearHistory={onClearHistory}
            fullBleed={browseFullBleed}
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
 * `columns` omitted so SearchResultsGrid uses its responsive default (4 cols at
 * ≤2880dp, 6 above). Down from the keyboard drops into results (no focus trap).
 */
function SearchBodyStacked(props: SearchBodyProps) {
  // Keyboard sits ABOVE a scrolling results grid, but tvOS swallows D-pad-up out
  // of the top row while the grid decelerates. So give the top row an explicit
  // `nextFocusUp`: the keyboard's first key node (two-pane needs none — keyboard is LEFT).
  const [keyboardLandingNode, setKeyboardLandingNode] =
    useState<ViewType | null>(null)
  return (
    <View style={styles.stackedBody}>
      {/* Like SearchKeyboard in the two-pane body, SearchKeyboardLinear is not
          given a dynamic React key: remounting it on a query/state change kills
          focus on the currently-pressed key. Keep it mounted. */}
      <SearchKeyboardLinear
        value={props.query}
        onChange={props.onChangeQuery}
        onSubmit={props.onSubmit}
        onLandingNodeChange={setKeyboardLandingNode}
      />
      <SearchResultsPane
        {...props}
        topRowFocusUp={keyboardLandingNode}
        browseFullBleed
      />
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
    paddingHorizontal: scale(SEARCH_PAGE_GUTTER),
  },
  // Design .s-query: padding 78px 0 (horizontal comes from screen).
  queryLine: {
    paddingTop: scale(78),
  },
  // Android: keyboard (left) + results (right) fill the height side by side.
  // Tight gap + no top inset so the results sit close to the keyboard's right
  // edge and near the top, just under the query line.
  twoPaneBody: {
    flex: 1,
    flexDirection: "row",
    gap: scale(24),
    paddingTop: 0,
  },
  // Apple TV: single-line keyboard on top, results filling the space below.
  stackedBody: {
    flex: 1,
    paddingTop: scale(14),
    gap: scale(8),
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
