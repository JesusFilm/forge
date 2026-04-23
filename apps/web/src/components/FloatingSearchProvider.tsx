"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import client from "@/lib/client"
import { SEMANTIC_SEARCH, type SearchResult } from "@/lib/search"
import { buildSearchUrl } from "@/lib/search-url"

import { FloatingSearchBar } from "./FloatingSearchBar"
import { SearchOverlay } from "./SearchOverlay"

export type FloatingSearchContextValue = {
  open: boolean
  closing: boolean
  query: string
  results: SearchResult[]
  displayResults: SearchResult[]
  exiting: boolean
  resultsKey: number
  hasMore: boolean
  loading: boolean
  showSkeleton: boolean
  loadingMore: boolean
  error: string | null
  searched: boolean
  hydratedOpen: boolean
  setOpen: (open: boolean) => void
  setQuery: (q: string) => void
  search: (q: string) => void
  loadMore: () => void
  closeAndKeepQuery: () => void
}

const FloatingSearchContext = createContext<FloatingSearchContextValue | null>(
  null,
)

export function useFloatingSearch(): FloatingSearchContextValue {
  const ctx = useContext(FloatingSearchContext)
  if (ctx === null) {
    throw new Error(
      "useFloatingSearch must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}

export function FloatingSearchProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const seededQuery = (searchParams.get("q") ?? "").slice(0, 200)

  const [open, setOpenState] = useState<boolean>(seededQuery.length > 0)
  const [closing, setClosing] = useState<boolean>(false)
  const [query, setQuery] = useState<string>(seededQuery)
  const [hydratedOpen] = useState<boolean>(seededQuery.length > 0)
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setOpen = useCallback((next: boolean) => {
    if (closingTimerRef.current) {
      clearTimeout(closingTimerRef.current)
      closingTimerRef.current = null
    }
    if (next) {
      setClosing(false)
      setOpenState(true)
    } else {
      setClosing(true)
      closingTimerRef.current = setTimeout(() => {
        setOpenState(false)
        setClosing(false)
        closingTimerRef.current = null
      }, 200)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current)
    }
  }, [])

  const [results, setResults] = useState<SearchResult[]>([])
  const [displayResults, setDisplayResults] = useState<SearchResult[]>([])
  const [exiting, setExiting] = useState(false)
  const [resultsKey, setResultsKey] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const requestIdRef = useRef(0)
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const displayResultsRef = useRef<SearchResult[]>([])
  useEffect(() => {
    displayResultsRef.current = displayResults
  }, [displayResults])

  const [portalReady, setPortalReady] = useState(false)
  useEffect(() => {
    setPortalReady(true)
  }, [])

  const search = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      setQuery(q)

      // URL sync — preserves any existing params (utm_*, etc.) and strips ?q=
      // when the query is empty. Reads current params at call time to avoid
      // stale closures after navigation.
      const currentParams =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams()
      const nextUrl = buildSearchUrl(pathname, currentParams, trimmed)
      router.replace(nextUrl as Route)

      if (!trimmed) {
        if (displayResultsRef.current.length > 0) {
          setExiting(true)
          await new Promise((r) => setTimeout(r, 200))
          setExiting(false)
        }
        setResults([])
        setDisplayResults([])
        setHasMore(false)
        setSearched(false)
        return
      }

      if (displayResultsRef.current.length > 0) {
        setExiting(true)
        await new Promise((r) => setTimeout(r, 200))
        setExiting(false)
        setDisplayResults([])
      }

      const thisRequest = ++requestIdRef.current
      setLoading(true)
      setError(null)
      setSearched(true)
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
      // Shorter skeleton threshold when the modal opened via URL hydration,
      // so the initial results-area blank window is less jarring.
      const skeletonThreshold = hydratedOpen ? 150 : 500
      skeletonTimerRef.current = setTimeout(
        () => setShowSkeleton(true),
        skeletonThreshold,
      )

      try {
        const result = await client.query({
          query: SEMANTIC_SEARCH,
          variables: {
            query: trimmed.slice(0, 200),
            locale: "en",
            limit: 20,
            offset: 0,
          },
          fetchPolicy: "no-cache",
        })

        // Discard stale response if a newer search has started.
        if (requestIdRef.current !== thisRequest) return

        const data = result.data?.semanticSearch
        const newResults = data?.results ?? []
        setResults(newResults)
        setDisplayResults(newResults)
        setResultsKey((k) => k + 1)
        setHasMore(data?.hasMore ?? false)
      } catch {
        setError("Search failed. Please try again.")
      } finally {
        if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
        setShowSkeleton(false)
        setLoading(false)
      }
    },
    [hydratedOpen, pathname, router],
  )

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    setError(null)
    try {
      const result = await client.query({
        query: SEMANTIC_SEARCH,
        variables: {
          query: query.trim().slice(0, 200),
          locale: "en",
          limit: 20,
          offset: results.length,
        },
        fetchPolicy: "no-cache",
      })
      const data = result.data?.semanticSearch
      if (data) {
        setResults((prev) => [...prev, ...data.results])
        setDisplayResults((prev) => [...prev, ...data.results])
        setHasMore(data.hasMore)
      }
    } catch {
      setError("Failed to load more results.")
    } finally {
      setLoadingMore(false)
    }
  }, [query, results.length])

  const closeAndKeepQuery = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  // On hydration with a non-empty seeded query, fire the initial search once.
  // The ref guard is what prevents re-runs when `search` identity changes;
  // the effect itself can list `search` in deps without triggering repeats.
  const didHydrateSearchRef = useRef(false)
  useEffect(() => {
    if (didHydrateSearchRef.current) return
    if (seededQuery.trim().length > 0) {
      didHydrateSearchRef.current = true
      void search(seededQuery)
    }
  }, [search, seededQuery])

  const value = useMemo<FloatingSearchContextValue>(
    () => ({
      open,
      closing,
      query,
      results,
      displayResults,
      exiting,
      resultsKey,
      hasMore,
      loading,
      showSkeleton,
      loadingMore,
      error,
      searched,
      hydratedOpen,
      setOpen,
      setQuery,
      search,
      loadMore,
      closeAndKeepQuery,
    }),
    [
      open,
      closing,
      query,
      results,
      displayResults,
      exiting,
      resultsKey,
      hasMore,
      loading,
      showSkeleton,
      loadingMore,
      error,
      searched,
      hydratedOpen,
      setOpen,
      search,
      loadMore,
      closeAndKeepQuery,
    ],
  )

  return (
    <FloatingSearchContext.Provider value={value}>
      <div inert={open || undefined} aria-hidden={open || undefined}>
        {children}
      </div>
      <FloatingSearchBar />
      <Link
        href={"/" as Route}
        aria-label="JesusFilm home"
        inert={open || undefined}
        aria-hidden={open || undefined}
        className={`fixed top-4 left-4 z-50 hidden sm:block transition-opacity duration-300 ease-out focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2 ${
          open ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        <Image
          src="/watch/images/jesusfilm-sign.svg"
          alt="JesusFilm"
          width={32}
          height={24}
          unoptimized
        />
      </Link>
      {portalReady && (open || closing)
        ? createPortal(<SearchOverlay />, document.body)
        : null}
    </FloatingSearchContext.Provider>
  )
}
