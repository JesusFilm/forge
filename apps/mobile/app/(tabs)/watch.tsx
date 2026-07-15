import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { useRouter } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"

import { getApolloClient } from "../../src/lib/apolloClient"
import { datadogLog } from "../../src/lib/datadog"
import {
  generateSearchRequestId,
  parseSearchErrorCode,
  resolveWatchSearchOutcome,
} from "../../src/lib/watchSearchLog"
import {
  GET_VIDEO_BY_SLUG,
  SEARCH,
  type SearchResult,
} from "../../src/lib/queries"
import { encodeWatchSeed } from "../../src/lib/watchSeed"
import { isSeriesSearchResult } from "../../src/lib/isSeriesRecord"
import { SearchResultCard } from "../../src/components/search/SearchResultCard"
import { SearchResultSkeleton } from "../../src/components/search/SearchResultSkeleton"
import { BrowseTopics } from "../../src/components/search/BrowseTopics"
import { useExperienceSelection } from "../../src/contexts/ExperienceSelectionProvider"
import {
  ACCENT,
  BG_COLOR,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../src/lib/color"

const MAX_QUERY_LENGTH = 200
const DEBOUNCE_MS = 300
const PAGE_SIZE = 20
const SKELETON_DELAY_MS = 500
const MAX_PREFETCH_INFLIGHT = 3

function parseSearchError(e: unknown): string {
  const gqlErrors = (
    e as {
      graphQLErrors?: {
        message: string
        extensions?: Record<string, unknown>
      }[]
    }
  )?.graphQLErrors

  if (gqlErrors?.length) {
    const ext = gqlErrors[0].extensions
    const code = ext?.code as string | undefined

    if (code === "RATE_LIMITED") {
      const seconds = ext?.retryAfterSeconds as number | undefined
      return seconds
        ? `Too many requests. Please wait ${seconds} seconds.`
        : "Too many requests. Please try again later."
    }
    if (code === "SERVICE_UNAVAILABLE") {
      return "Search is temporarily unavailable. Please try again."
    }
    // Admin rejected the search bearer (missing, or rotated out of the CSV).
    // Retrying can't help — only a new token (dev) or app update (prod) can.
    if (code === "UNAUTHENTICATED") {
      if (__DEV__) {
        console.warn(
          "[search] UNAUTHENTICATED — set EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN in .env.local and cold-restart Metro",
        )
      }
      return "Search isn't available in this app version. Please update the app."
    }
  }

  return "Search failed. Please try again."
}

export default function DiscoverScreen() {
  const router = useRouter()
  const { selectExperience } = useExperienceSelection()

  // Warm the detail query on touch-down so navigation reads a warm cache.
  // Deduped by slug and capped in flight so a fast scroll-and-press can't
  // burst the heavy query against admin.
  const prefetchedRef = useRef<Set<string>>(new Set())
  const prefetchInFlightRef = useRef(0)

  const handlePrefetch = useCallback((result: SearchResult) => {
    if (result.type === "EXPERIENCE") return
    const slug = result.slug
    if (prefetchedRef.current.has(slug)) return
    // Prefetch cap saturation (R35): a fast scroll-and-press drops warm-ups.
    if (prefetchInFlightRef.current >= MAX_PREFETCH_INFLIGHT) {
      datadogLog.info("search.prefetch", {
        requested: prefetchInFlightRef.current + 1,
        capped: MAX_PREFETCH_INFLIGHT,
      })
      return
    }
    prefetchedRef.current.add(slug)
    prefetchInFlightRef.current += 1
    getApolloClient()
      .query({
        query: GET_VIDEO_BY_SLUG,
        variables: { slug, locale: "en" },
        fetchPolicy: "cache-first",
      })
      .catch(() => {
        // Allow a later real navigation to retry.
        prefetchedRef.current.delete(slug)
      })
      .finally(() => {
        prefetchInFlightRef.current -= 1
      })
  }, [])

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      // Join the click back to its originating search (result_clicked ↔
      // watch_search share search_request_id); content_id = slug so the detail
      // route's content.resolution joins the same journey.
      datadogLog.info("search.result_clicked", {
        search_request_id: searchRequestIdRef.current,
        position: resultsRef.current.indexOf(result),
        content_id: result.slug,
      })
      if (result.type === "EXPERIENCE") {
        selectExperience(result.slug)
        router.push(`/experience/${encodeURIComponent(result.slug)}`)
        return
      }
      // Carry seed data forward so the detail screen paints instantly.
      const seed = encodeWatchSeed({
        slug: result.slug,
        title: result.title ?? null,
        imageUrl: result.imageUrl ?? null,
        playbackId: result.playbackId ?? null,
      })
      // A series-shaped result (SERIES/COLLECTION label, or has children) opens
      // the series page; a single video opens the watch page.
      const route = isSeriesSearchResult(result) ? "series" : "watch"
      router.push(`/${route}/${encodeURIComponent(result.slug)}?seed=${seed}`)
    },
    [selectExperience, router],
  )

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  // Current search's correlation id + a live results mirror, both read by
  // handleSelectResult to attribute a click to its search without dep churn.
  const searchRequestIdRef = useRef("")
  const resultsRef = useRef<SearchResult[]>([])
  const fadeAnim = useRef(new Animated.Value(1)).current
  const scaleAnim = useRef(new Animated.Value(1)).current
  const [resultsKey, setResultsKey] = useState(0)
  const browseAnim = useRef(new Animated.Value(0)).current
  const browseScale = useRef(new Animated.Value(0.97)).current
  const [browseMounted, setBrowseMounted] = useState(true)

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    }
  }, [])

  // Keep the click-time position lookup current without re-memoizing the row
  // handlers (which would churn the FlatList).
  useEffect(() => {
    resultsRef.current = results
  }, [results])

  // Fade the browse grid in and out the same way the results animate: fade +
  // slight scale in on enter, fade out then unmount on leave.
  const showBrowse = !searched && !loading
  useEffect(() => {
    if (showBrowse) {
      setBrowseMounted(true)
      browseAnim.setValue(0)
      browseScale.setValue(0.97)
      Animated.parallel([
        Animated.timing(browseAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(browseScale, {
          toValue: 1,
          useNativeDriver: true,
          tension: 80,
          friction: 9,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.timing(browseAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(browseScale, {
          toValue: 0.95,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setBrowseMounted(false)
      })
    }
  }, [showBrowse, browseAnim, browseScale])

  const animateOut = useCallback((): Promise<void> => {
    if (results.length === 0) return Promise.resolve()
    return new Promise((resolve) => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.95,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start(() => resolve())
    })
  }, [results.length, fadeAnim, scaleAnim])

  const search = useCallback(
    async (q: string) => {
      const trimmed = q.trim().slice(0, MAX_QUERY_LENGTH)
      // Bump first so an empty/clear query invalidates any in-flight search —
      // otherwise a stale result lands over the browse grid after clearing, and
      // its guarded finally never resets loading.
      const thisRequest = ++requestIdRef.current
      if (!trimmed) {
        await animateOut()
        setResults([])
        setHasMore(false)
        setSearched(false)
        setLoading(false)
        setError(null)
        setShowSkeleton(false)
        if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
        fadeAnim.setValue(1)
        scaleAnim.setValue(1)
        return
      }

      // Animate out existing results before loading new ones
      if (results.length > 0) {
        await animateOut()
      }

      // Check staleness after the animation await — another search may have fired
      if (requestIdRef.current !== thisRequest) return

      setLoading(true)
      setError(null)
      setSearched(true)

      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
      skeletonTimerRef.current = setTimeout(
        () => setShowSkeleton(true),
        SKELETON_DELAY_MS,
      )

      // One correlation id per search, joined by result_clicked (R33/R35).
      const searchRequestId = generateSearchRequestId()
      searchRequestIdRef.current = searchRequestId
      const startedAt = Date.now()

      try {
        const result = await getApolloClient().query({
          query: SEARCH,
          variables: {
            q: trimmed,
            locale: "en",
            limit: PAGE_SIZE,
            offset: 0,
          },
          fetchPolicy: "no-cache",
        })

        if (requestIdRef.current !== thisRequest) return

        const data = result.data?.search
        const newResults = [...(data?.results ?? [])]
        setResults(newResults)
        setHasMore(data?.hasMore ?? false)
        setResultsKey((k) => k + 1)

        const { outcome, result_count } = resolveWatchSearchOutcome({
          results: newResults,
        })
        // Raw query term is deliberately NOT logged (privacy parity with web:
        // result metadata + search_request_id only, never what the user typed).
        datadogLog.info("watch_search", {
          outcome,
          result_count,
          latency_ms: Date.now() - startedAt,
          request_type: "initial",
          search_request_id: searchRequestId,
        })

        fadeAnim.setValue(0)
        scaleAnim.setValue(0.97)
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            tension: 80,
            friction: 9,
          }),
        ]).start()
      } catch (e: unknown) {
        if (requestIdRef.current !== thisRequest) return
        setError(parseSearchError(e))
        // Rate-limit/auth reject as a 200-body GraphQL code, not a 429 (R34).
        datadogLog.warn("watch_search_failed", {
          code: parseSearchErrorCode(e),
          request_type: "initial",
          search_request_id: searchRequestId,
        })
      } finally {
        if (requestIdRef.current === thisRequest) {
          if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
          setShowSkeleton(false)
          setLoading(false)
        }
      }
    },
    [fadeAnim, scaleAnim, animateOut, results.length],
  )

  function handleChangeText(text: string) {
    setQuery(text)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(text), DEBOUNCE_MS)
  }

  // Tapping a browse topic fills the bar and searches immediately, reusing the
  // same stale-guarded search() — no debounce wait, no second fetch path.
  function handleSelectTopic(term: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    setQuery(term)
    void search(term)
  }

  // The search bar's clear (X) button: wipe the input and return to the browse
  // bubbles immediately — search("") resets searched to false, no debounce.
  function handleClear() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setQuery("")
    void search("")
  }

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return

    const thisRequest = requestIdRef.current
    setLoadingMore(true)
    setError(null)

    // Pagination shares the initiating search's correlation id (request_type
    // distinguishes the page from the initial fetch).
    const term = query.trim().slice(0, MAX_QUERY_LENGTH)
    const searchRequestId = searchRequestIdRef.current
    const startedAt = Date.now()

    try {
      const result = await getApolloClient().query({
        query: SEARCH,
        variables: {
          q: term,
          locale: "en",
          limit: PAGE_SIZE,
          offset: results.length,
        },
        fetchPolicy: "no-cache",
      })

      if (requestIdRef.current !== thisRequest) return

      const data = result.data?.search
      if (data) {
        setResults((prev) => [...prev, ...[...data.results]])
        setHasMore(data.hasMore)

        const { outcome, result_count } = resolveWatchSearchOutcome({
          results: data.results,
        })
        datadogLog.info("watch_search", {
          outcome,
          result_count,
          latency_ms: Date.now() - startedAt,
          request_type: "page",
          search_request_id: searchRequestId,
        })
      }
    } catch (e: unknown) {
      if (requestIdRef.current !== thisRequest) return
      setError(parseSearchError(e))
      datadogLog.warn("watch_search_failed", {
        code: parseSearchErrorCode(e),
        request_type: "page",
        search_request_id: searchRequestId,
      })
    } finally {
      // Always clear loadingMore — even if superseded by a new search,
      // otherwise loadingMore stays true forever and pagination breaks
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, query, results.length])

  const renderItem = useCallback(
    ({ item, index }: { item: SearchResult; index: number }) => (
      <SearchResultCard
        result={item}
        index={index}
        onSelect={handleSelectResult}
        onPressIn={handlePrefetch}
      />
    ),
    [handleSelectResult, handlePrefetch],
  )

  const keyExtractor = useCallback(
    (item: SearchResult, index: number) => `${item.type}-${item.id}-${index}`,
    [],
  )

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={handleChangeText}
            placeholder="Search for videos about any topic..."
            placeholderTextColor={TEXT_SECONDARY}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={ACCENT}
          />
          {query.length > 0 && (
            <Pressable
              style={styles.clearButton}
              onPress={handleClear}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={20} color={TEXT_SECONDARY} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.contentArea}>
        {browseMounted && (
          <Animated.View
            style={[
              styles.browseLayer,
              { opacity: browseAnim, transform: [{ scale: browseScale }] },
            ]}
          >
            <BrowseTopics onSelect={handleSelectTopic} />
          </Animated.View>
        )}

        {loading && showSkeleton && <SearchResultSkeleton />}

        {!loading && searched && results.length === 0 && !error && (
          <View style={styles.emptyState}>
            <Text style={styles.noResultsTitle}>
              No results for &apos;{query.trim()}&apos;
            </Text>
            <Text style={styles.noResultsBody}>
              Try different keywords or browse experiences
            </Text>
          </View>
        )}

        {error && results.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.retryLink} onPress={() => search(query)}>
              Retry
            </Text>
          </View>
        )}

        {results.length > 0 && (
          <Animated.View
            style={{
              flex: 1,
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            }}
          >
            <FlatList
              key={resultsKey}
              data={results}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              numColumns={2}
              keyboardDismissMode="on-drag"
              contentContainerStyle={styles.listContent}
              columnWrapperStyle={styles.columnWrapper}
              ListFooterComponent={
                <>
                  {error && (
                    <View style={styles.inlineError}>
                      <Text style={styles.errorText}>{error}</Text>
                      <Text style={styles.retryLink} onPress={loadMore}>
                        Retry
                      </Text>
                    </View>
                  )}
                  {hasMore && !error && (
                    <View style={styles.loadMoreContainer}>
                      <Text
                        style={styles.loadMoreButton}
                        onPress={loadMore}
                        suppressHighlighting={loadingMore}
                      >
                        {loadingMore ? "Loading..." : "Load more"}
                      </Text>
                    </View>
                  )}
                </>
              }
            />
          </Animated.View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  contentArea: {
    flex: 1,
  },
  browseLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  input: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: 24,
    paddingLeft: 20,
    paddingRight: 44,
    paddingVertical: 12,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
  },
  inputWrapper: {
    justifyContent: "center",
  },
  clearButton: {
    position: "absolute",
    right: 6,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  noResultsTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
    fontSize: 18,
    textAlign: "center",
    marginBottom: 8,
  },
  noResultsBody: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 14,
    textAlign: "center",
  },
  errorText: {
    color: "#ef4444",
    fontFamily: "System",
    fontSize: 14,
    textAlign: "center",
  },
  retryLink: {
    color: ACCENT,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 12,
    textAlign: "center",
  },
  inlineError: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 32,
  },
  columnWrapper: {
    justifyContent: "space-between",
  },
  loadMoreContainer: {
    alignItems: "center",
    paddingVertical: 20,
  },
  loadMoreButton: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    overflow: "hidden",
  },
})
