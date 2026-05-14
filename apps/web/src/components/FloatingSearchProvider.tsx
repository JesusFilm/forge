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
import { usePathname, useRouter } from "next/navigation"

import { runSearch } from "@/lib/search-actions"
import type { SearchResult } from "@/lib/search"
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
  setOpen: (open: boolean) => void
  setQuery: (q: string) => void
  search: (q: string) => Promise<void>
  loadMore: () => Promise<void>
  closeAndKeepQuery: () => void
}

export type FloatingSearchPinnedContextValue = {
  pinned: boolean
}

const FloatingSearchContext = createContext<FloatingSearchContextValue | null>(
  null,
)
const FloatingSearchPinnedContext =
  createContext<FloatingSearchPinnedContextValue | null>(null)

export function useFloatingSearch(): FloatingSearchContextValue {
  const ctx = useContext(FloatingSearchContext)
  if (ctx === null) {
    throw new Error(
      "useFloatingSearch must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}

export function useFloatingSearchPinned(): FloatingSearchPinnedContextValue {
  const ctx = useContext(FloatingSearchPinnedContext)
  if (ctx === null) {
    throw new Error(
      "useFloatingSearchPinned must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}

export function FloatingSearchProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  // usePathname() returns the app-relative path (no basePath prefix). The
  // router.replace() call auto-prefixes basePath, so feeding it
  // window.location.pathname (which includes basePath) would double-prefix
  // on every search. usePathname() does NOT force the Full Route Cache
  // deopt that useSearchParams() would.
  const pathname = usePathname()

  // Open/query state starts false — the URL-hydration effect below seeds it
  // after mount. Reading useSearchParams() here would force every route under
  // this layout out of the Full Route Cache, so we trade a one-frame flash of
  // closed modal for preserved ISR on all pages.
  const [open, setOpenState] = useState<boolean>(false)
  const [closing, setClosing] = useState<boolean>(false)
  const [query, setQuery] = useState<string>("")
  const [pinned, setPinned] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.scrollY > 80 : false,
  )
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Whether the modal was opened via URL hydration (vs user click). Gates a
  // shorter skeleton threshold so the URL-hydrated blank window is less jarring.
  const hydratedOpenRef = useRef<boolean>(false)

  // Scroll-driven pinned state. Shared between the floating searchbar and
  // the floating logo so they track together. Listener registers only while
  // modal is closed (body scroll lock keeps scrollY fixed while open).
  useEffect(() => {
    if (open) return
    if (typeof window === "undefined") return
    let frame = 0
    const onScroll = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        setPinned(window.scrollY > 80)
        frame = 0
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [open])

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
  const loadingMoreRef = useRef(false)
  const displayResultsRef = useRef<SearchResult[]>([])
  useEffect(() => {
    displayResultsRef.current = displayResults
  }, [displayResults])

  // Cancel any pending skeleton timer on unmount.
  useEffect(() => {
    return () => {
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    }
  }, [])

  const [portalReady, setPortalReady] = useState(false)
  useEffect(() => {
    setPortalReady(true)
  }, [])

  const search = useCallback(
    async (q: string): Promise<void> => {
      const trimmed = q.trim()
      setQuery(q)

      // Bump the request id immediately so any in-flight request (from a prior
      // call in any branch — exit-animation, Apollo, or clear) fails its
      // freshness check when it resolves.
      const thisRequest = ++requestIdRef.current

      // URL sync — preserves any existing params (utm_*, etc.) and strips ?q=
      // when the query is empty. Use usePathname() (app-relative) so
      // router.replace's auto basePath prefix isn't applied twice.
      const currentParams =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams()
      const nextUrl = buildSearchUrl(pathname, currentParams, trimmed)
      router.replace(nextUrl as Route)

      if (!trimmed) {
        if (displayResultsRef.current.length > 0) {
          setExiting(true)
          await new Promise<void>((resolve) => setTimeout(resolve, 200))
          if (requestIdRef.current !== thisRequest) return
          setExiting(false)
        }
        if (requestIdRef.current !== thisRequest) return
        setResults([])
        setDisplayResults([])
        setHasMore(false)
        setSearched(false)
        setError(null)
        return
      }

      if (displayResultsRef.current.length > 0) {
        setExiting(true)
        await new Promise<void>((resolve) => setTimeout(resolve, 200))
        if (requestIdRef.current !== thisRequest) return
        setExiting(false)
        setDisplayResults([])
      }

      setLoading(true)
      setError(null)
      setSearched(true)
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
      const skeletonThreshold = hydratedOpenRef.current ? 150 : 500
      skeletonTimerRef.current = setTimeout(() => {
        if (requestIdRef.current === thisRequest) setShowSkeleton(true)
      }, skeletonThreshold)

      try {
        const data = await runSearch({
          query: trimmed.slice(0, 200),
          limit: 20,
          offset: 0,
        })

        if (requestIdRef.current !== thisRequest) return

        const newResults = data.results
        setResults(newResults)
        setDisplayResults(newResults)
        setResultsKey((k) => k + 1)
        setHasMore(data.hasMore)
      } catch {
        if (requestIdRef.current === thisRequest) {
          setError("Search failed. Please try again.")
        }
      } finally {
        // Only clear loading state for the winning request — otherwise a
        // stale response's finally would drop the active spinner mid-fetch.
        if (requestIdRef.current === thisRequest) {
          if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
          setShowSkeleton(false)
          setLoading(false)
        }
      }
    },
    [pathname, router],
  )

  const loadMore = useCallback(async (): Promise<void> => {
    // Synchronous guard against double-fire before React commits `disabled`.
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError(null)
    // Capture the current search's request id; bail out of the append if a
    // new search supersedes us mid-fetch.
    const thisRequest = requestIdRef.current
    try {
      const data = await runSearch({
        query: query.trim().slice(0, 200),
        limit: 20,
        offset: results.length,
      })
      if (requestIdRef.current !== thisRequest) return
      setResults((prev) => [...prev, ...data.results])
      setDisplayResults((prev) => [...prev, ...data.results])
      setHasMore(data.hasMore)
    } catch {
      if (requestIdRef.current === thisRequest) {
        setError("Failed to load more results.")
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [query, results.length])

  const closeAndKeepQuery = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  // On first client mount, seed state from ?q= in the URL.
  const didHydrateRef = useRef(false)
  useEffect(() => {
    if (didHydrateRef.current) return
    didHydrateRef.current = true
    if (typeof window === "undefined") return
    const seeded = new URLSearchParams(window.location.search).get("q") ?? ""
    const trimmed = seeded.slice(0, 200)
    if (trimmed.length === 0) return
    hydratedOpenRef.current = true
    setQuery(trimmed)
    setOpenState(true)
    void search(trimmed)
  }, [search])

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
      setOpen,
      search,
      loadMore,
      closeAndKeepQuery,
    ],
  )

  // Pinned lives on its own context so scroll-rate state updates don't
  // re-render the modal result grid (up to 20 VideoCards).
  const pinnedValue = useMemo<FloatingSearchPinnedContextValue>(
    () => ({ pinned }),
    [pinned],
  )

  const chromeHidden = open || closing

  return (
    <FloatingSearchContext.Provider value={value}>
      <FloatingSearchPinnedContext.Provider value={pinnedValue}>
        <div
          inert={chromeHidden || undefined}
          aria-hidden={chromeHidden || undefined}
        >
          {children}
        </div>
        <FloatingSearchBar />
        <Link
          href={"/" as Route}
          aria-label="JesusFilm home"
          inert={chromeHidden || undefined}
          aria-hidden={chromeHidden || undefined}
          // Clear the search query (and ?q= URL param + cached results) on
          // click so the home navigation lands on a fresh search bar instead
          // of carrying the previous query across.
          onClick={() => {
            void search("")
          }}
          className={`fixed left-10 z-50 hidden sm:flex h-12 items-center transition-[top,opacity] duration-300 ease-out focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2 ${
            pinned ? "top-3" : "top-10"
          } ${chromeHidden ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        >
          <Image
            src="/watch/images/jesusfilm-sign.svg"
            alt="JesusFilm"
            width={32}
            height={24}
            unoptimized
            className="drop-shadow-md"
          />
        </Link>
        {portalReady && chromeHidden
          ? createPortal(<SearchOverlay />, document.body)
          : null}
      </FloatingSearchPinnedContext.Provider>
    </FloatingSearchContext.Provider>
  )
}
