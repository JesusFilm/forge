import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BackHandler, Platform, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import {
  isNativeSearchAvailable,
  TvosSearchView,
  type SearchEvent,
  type SelectItemEvent,
} from "expo-tvos-search"

import { QueryDisplay } from "../src/components/search/QueryDisplay"
import {
  findResultById,
  toNativeSearchResults,
} from "../src/components/search/nativeSearchResults"
import { searchResultPath } from "../src/components/search/searchResultPath"
import { VoiceSearchButton } from "../src/components/search/VoiceSearchButton"
import { WATCH_THEME } from "../src/components/watch/watchDetailTheme"
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
import { useVoiceSearch } from "../src/lib/voiceSearch/useVoiceSearch"
import { meetsMinQueryLength } from "../src/lib/searchGate"
import { useSearchHistory } from "../src/lib/searchHistory"

/**
 * /search route — Apple TV (Platform.OS "ios") = NATIVE SwiftUI search surface
 * (expo-tvos-search): the only path that receives Siri Remote system dictation,
 * since tvOS gives third-party apps no mic access and dictation writes solely
 * into Apple's own text primitive. Falls back to the custom linear keyboard if
 * the native module is unavailable. Android TV = left grid keyboard + right pane.
 * (The 2026-06-22 spike crash was react-native-screens' SearchBar — NOT this
 * module; see docs/superpowers/specs/2026-06-22-tv-apple-linear-search-keyboard-design.md.)
 */
export default function SearchScreen() {
  const [query, setQuery] = useState("")
  const {
    state,
    results,
    lastSubmittedQuery,
    searchRequestId,
    submit,
    runQuery,
    retry,
  } = useSemanticSearch(query)
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

  // Android TV voice search: partial/final transcripts write through the SAME
  // sanitize chokepoint as typed keys, then ride the normal debounce → search
  // path. `available` is false everywhere the recognizer doesn't exist (Apple
  // TV, emulators without Google speech services), which hides the mic button.
  const voice = useVoiceSearch(setSanitizedQuery)

  // ── Back-from-results choreography (Android) ── Back with focus in the
  // results region re-parks focus on the mic button (fast repeat searches);
  // Back from the keyboard/search-bar region pops the screen as usual. The
  // region flag flips on card focus vs key/mic focus — refs, not state, so
  // D-pad traversal never re-renders the screen.
  const resultsRegionFocusedRef = useRef(false)
  const handleCardFocus = useCallback(() => {
    resultsRegionFocusedRef.current = true
  }, [])
  const handleEntryRegionFocus = useCallback(() => {
    resultsRegionFocusedRef.current = false
  }, [])
  // react-native-tvos host nodes expose requestTVFocus() (absent from the
  // bundled View type) — same local cast as focusMemory.ts.
  const micNodeRef = useRef<
    (ViewType & { requestTVFocus?: () => void }) | null
  >(null)
  const setMicNode = useCallback((node: ViewType | null) => {
    micNodeRef.current = node
  }, [])
  const voiceListeningRef = useRef(false)
  voiceListeningRef.current = voice.listening
  const voiceCancelRef = useRef(voice.cancel)
  voiceCancelRef.current = voice.cancel
  useEffect(() => {
    if (Platform.OS !== "android") return
    const handler = () => {
      // Back during a voice session aborts the session, nothing else.
      if (voiceListeningRef.current) {
        voiceCancelRef.current()
        return true
      }
      if (resultsRegionFocusedRef.current) {
        resultsRegionFocusedRef.current = false
        micNodeRef.current?.requestTVFocus?.()
        return true
      }
      return false
    }
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      handler,
    )
    return () => subscription.remove()
  }, [])

  // Recent / Category click runs a fresh search immediately, bypassing the 900ms
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

  // Google Assistant app-search ("search for X on Jesus Film Watch"): the
  // intent bridge routes here with ?q=<spoken text>. Run it immediately —
  // runQueryImmediate sanitizes at the write site like every other source.
  // The ref keeps a re-render (or focus re-entry) from re-firing the same
  // spoken query after the user has moved on.
  const { q } = useLocalSearchParams<{ q?: string }>()
  const lastAssistantQueryRef = useRef<string | null>(null)
  useEffect(() => {
    const incoming = typeof q === "string" ? q : undefined
    if (incoming == null || incoming.trim().length === 0) return
    if (lastAssistantQueryRef.current === incoming) return
    lastAssistantQueryRef.current = incoming
    runQueryImmediate(incoming)
  }, [q, runQueryImmediate])

  // Under the min length the browse view stays mounted (no blank/stale pane);
  // the SAME gate the debounce path uses, so results appear exactly when search
  // fires. Whitespace-only trims to empty and also falls back to SearchBrowse.
  const hasQuery = meetsMinQueryLength(query)
  const meta = resolveSearchMeta(state, results.length)

  const bodyProps: SearchBodyProps = {
    query,
    state,
    results,
    searchRequestId,
    meta,
    hasQuery,
    onChangeQuery: setSanitizedQuery,
    onSubmit: submit,
    onRunQuery: runQueryImmediate,
    onClearHistory: clearAll,
    recents,
    onRetry: retry,
    onKeyFocus: handleEntryRegionFocus,
    onCardFocus: handleCardFocus,
  }

  // Apple TV: native SwiftUI .searchable surface (expo-tvos-search) — the ONLY
  // path that receives Siri Remote system dictation ("Hold 🎤 to dictate").
  // tvOS gives third-party apps no mic access; dictation writes exclusively
  // into Apple's own text primitive, so the input+results presentation is
  // native while ALL data plumbing (sanitizer → debounce → watchSearch →
  // telemetry → recents) stays this screen's. Falls back to the custom
  // keyboard if the native module is unavailable.
  if (Platform.OS === "ios" && isNativeSearchAvailable()) {
    return (
      <SearchBodyNativeTvos
        state={state}
        results={results}
        onChangeQuery={setSanitizedQuery}
      />
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.queryLine}>
        {voice.available ? (
          <VoiceSearchButton
            listening={voice.listening}
            onPress={voice.start}
            onFocusIn={handleEntryRegionFocus}
            nodeRef={setMicNode}
          />
        ) : null}
        <View style={styles.queryDisplayWrap}>
          <QueryDisplay value={query} />
        </View>
        {voice.listening ? (
          <Text style={styles.listeningHint}>Listening…</Text>
        ) : null}
      </View>
      {Platform.OS === "ios" ? (
        <SearchBodyStacked {...bodyProps} />
      ) : (
        <SearchBodyTwoPane {...bodyProps} />
      )}
    </View>
  )
}

/**
 * Apple TV native search body. The native view owns field + keyboard + results
 * grid; we own the data: onSearch feeds the SAME sanitized-query state the
 * custom keyboards write (debounce/min-length/telemetry/recents unchanged),
 * and selection routes through searchResultPath exactly like ResultCard.
 */
function SearchBodyNativeTvos({
  state,
  results,
  onChangeQuery,
}: {
  state: SearchState
  results: SearchResult[]
  onChangeQuery: (next: string) => void
}) {
  const router = useRouter()

  const nativeResults = useMemo(() => toNativeSearchResults(results), [results])

  const handleSearch = useCallback(
    (event: SearchEvent) => {
      onChangeQuery(event.nativeEvent.query)
    },
    [onChangeQuery],
  )

  const handleSelectItem = useCallback(
    (event: SelectItemEvent) => {
      const match = findResultById(results, event.nativeEvent.id)
      if (match != null) router.push(searchResultPath(match))
    },
    [results, router],
  )

  return (
    <View style={styles.nativeScreen}>
      <TvosSearchView
        style={styles.nativeSearch}
        results={nativeResults}
        onSearch={handleSearch}
        onSelectItem={handleSelectItem}
        isLoading={state === "loading"}
        placeholder="Search"
        colorScheme="dark"
        accentColor={WATCH_THEME.accent}
        showTitle
        emptyStateText="Search films, series, and topics"
        searchingText="Searching…"
        noResultsText="No results found"
        noResultsHintText="Try a different word — or hold the mic button to dictate"
      />
    </View>
  )
}

type SearchBodyProps = {
  query: string
  state: SearchState
  results: SearchResult[]
  searchRequestId: string
  meta: string
  hasQuery: boolean
  onChangeQuery: (next: string) => void
  onSubmit: () => void
  onRunQuery: (next: string) => void
  onClearHistory: () => void
  recents: string[]
  onRetry: () => void
  /** Screen-level focus-region signals: keyboard keys report "entry region",
   *  result cards report "results region" — Back consults the flag. */
  onKeyFocus?: () => void
  onCardFocus?: () => void
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
  searchRequestId,
  meta,
  hasQuery,
  recents,
  onRunQuery,
  onClearHistory,
  onRetry,
  onCardFocus,
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
            searchRequestId={searchRequestId}
            columns={columns}
            onRetry={onRetry}
            topRowFocusUp={topRowFocusUp}
            onCardFocus={onCardFocus}
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
          onKeyFocus={props.onKeyFocus}
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
  // Native tvOS search: the SwiftUI surface owns its own insets — no gutter,
  // just the app background behind it so transitions don't flash white.
  nativeScreen: {
    flex: 1,
    backgroundColor: SEARCH_THEME.bg,
  },
  nativeSearch: {
    flex: 1,
  },
  // Design .s-query: padding 78px 0 (horizontal comes from screen).
  queryLine: {
    paddingTop: scale(78),
    // Row: mic button (left) · query text (flex) · "Listening…" hint (right).
    flexDirection: "row",
    alignItems: "center",
    gap: scale(24),
  },
  // Flexes so a long query yields room instead of pushing the hint off-canvas
  // (QueryDisplay's own text already flexShrinks inside).
  queryDisplayWrap: {
    flex: 1,
  },
  listeningHint: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "700",
    letterSpacing: scale(1.5),
    color: WATCH_THEME.accent,
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
