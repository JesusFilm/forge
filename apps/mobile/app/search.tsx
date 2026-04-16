import { useCallback, useRef, useState } from "react"
import {
  Animated,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { getApolloClient } from "../src/lib/apolloClient"
import { SEMANTIC_SEARCH, type SearchResult } from "../src/lib/queries"
import { SearchResultCard } from "../src/components/search/SearchResultCard"
import {
  ACCENT,
  BG_COLOR,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../src/lib/color"

const MAX_QUERY_LENGTH = 200
const DEBOUNCE_MS = 300
const PAGE_SIZE = 20
const SKELETON_DELAY_MS = 500

export default function SearchScreen() {
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
  const fadeAnim = useRef(new Animated.Value(1)).current

  const search = useCallback(
    async (q: string) => {
      const trimmed = q.trim().slice(0, MAX_QUERY_LENGTH)
      if (!trimmed) {
        setResults([])
        setHasMore(false)
        setSearched(false)
        setError(null)
        setShowSkeleton(false)
        if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
        return
      }

      const thisRequest = ++requestIdRef.current
      setLoading(true)
      setError(null)
      setSearched(true)

      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
      skeletonTimerRef.current = setTimeout(
        () => setShowSkeleton(true),
        SKELETON_DELAY_MS,
      )

      try {
        const result = await getApolloClient().query({
          query: SEMANTIC_SEARCH,
          variables: {
            query: trimmed,
            locale: "en",
            limit: PAGE_SIZE,
            offset: 0,
          },
          fetchPolicy: "no-cache",
        })

        if (requestIdRef.current !== thisRequest) return

        const data = result.data?.semanticSearch
        const newResults = (data?.results ?? []) as SearchResult[]
        setResults(newResults)
        setHasMore(data?.hasMore ?? false)

        fadeAnim.setValue(0)
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start()
      } catch {
        if (requestIdRef.current !== thisRequest) return
        setError("Search failed. Please try again.")
      } finally {
        if (requestIdRef.current === thisRequest) {
          if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
          setShowSkeleton(false)
          setLoading(false)
        }
      }
    },
    [fadeAnim],
  )

  function handleChangeText(text: string) {
    setQuery(text)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(text), DEBOUNCE_MS)
  }

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return

    const thisRequest = requestIdRef.current
    setLoadingMore(true)
    setError(null)

    try {
      const result = await getApolloClient().query({
        query: SEMANTIC_SEARCH,
        variables: {
          query: query.trim().slice(0, MAX_QUERY_LENGTH),
          locale: "en",
          limit: PAGE_SIZE,
          offset: results.length,
        },
        fetchPolicy: "no-cache",
      })

      if (requestIdRef.current !== thisRequest) return

      const data = result.data?.semanticSearch
      if (data) {
        setResults((prev) => [...prev, ...(data.results as SearchResult[])])
        setHasMore(data.hasMore)
      }
    } catch {
      if (requestIdRef.current !== thisRequest) return
      setError("Failed to load more results.")
    } finally {
      if (requestIdRef.current === thisRequest) {
        setLoadingMore(false)
      }
    }
  }, [loadingMore, hasMore, query, results.length])

  const renderItem = useCallback(
    ({ item }: { item: SearchResult }) => <SearchResultCard result={item} />,
    [],
  )

  const keyExtractor = useCallback(
    (item: SearchResult, index: number) => `${item.type}-${item.id}-${index}`,
    [],
  )

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleChangeText}
          placeholder="Search for videos about any topic..."
          placeholderTextColor={TEXT_SECONDARY}
          autoFocus
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={ACCENT}
        />
      </View>

      {!searched && !loading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Search for videos about any topic
          </Text>
        </View>
      )}

      {loading && showSkeleton && (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={styles.skeletonInner} />
            </View>
          ))}
        </View>
      )}

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
        </View>
      )}

      {results.length > 0 && (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <FlatList
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
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  input: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 16,
    textAlign: "center",
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
  inlineError: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  skeletonCard: {
    width: "50%",
    padding: 6,
  },
  skeletonInner: {
    aspectRatio: 4 / 3,
    borderRadius: 16,
    backgroundColor: SURFACE_COLOR,
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
