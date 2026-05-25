import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { useRouter } from "expo-router"

import { getApolloClient } from "../../src/lib/apolloClient"
import { SEARCH, type SearchResult } from "../../src/lib/queries"
import { SearchResultCard } from "../../src/components/search/SearchResultCard"
import { SearchResultSkeleton } from "../../src/components/search/SearchResultSkeleton"
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
  }

  return "Search failed. Please try again."
}

export default function DiscoverScreen() {
  const router = useRouter()
  const { selectExperience } = useExperienceSelection()

  const handleSelectResult = useCallback(
    (slug: string, type: string) => {
      if (type === "experience") {
        selectExperience(slug)
        router.navigate("/(tabs)")
      } else {
        router.push(`/watch/${encodeURIComponent(slug)}`)
      }
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
  const fadeAnim = useRef(new Animated.Value(1)).current
  const scaleAnim = useRef(new Animated.Value(1)).current
  const [resultsKey, setResultsKey] = useState(0)

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    }
  }, [])

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
      if (!trimmed) {
        await animateOut()
        setResults([])
        setHasMore(false)
        setSearched(false)
        setError(null)
        setShowSkeleton(false)
        if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
        fadeAnim.setValue(1)
        scaleAnim.setValue(1)
        return
      }

      const thisRequest = ++requestIdRef.current

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

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return

    const thisRequest = requestIdRef.current
    setLoadingMore(true)
    setError(null)

    try {
      const result = await getApolloClient().query({
        query: SEARCH,
        variables: {
          q: query.trim().slice(0, MAX_QUERY_LENGTH),
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
      }
    } catch (e: unknown) {
      if (requestIdRef.current !== thisRequest) return
      setError(parseSearchError(e))
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
        onSelect={(slug) => handleSelectResult(slug, item.type)}
      />
    ),
    [handleSelectResult],
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
