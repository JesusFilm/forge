"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import client from "@/lib/client"
import { SEMANTIC_SEARCH, type SearchResult } from "@/lib/search"
import { VideoCard } from "./search/VideoCard"

type SearchOverlayProps = {
  open: boolean
  onClose: () => void
  closing?: boolean
}

export function SearchOverlay({ open, onClose, closing }: SearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [displayResults, setDisplayResults] = useState<SearchResult[]>([])
  const [exiting, setExiting] = useState(false)
  const [resultsKey, setResultsKey] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
    setQuery("")
    setResults([])
    setDisplayResults([])
    setExiting(false)
    setHasMore(false)
    setError(null)
    setSearched(false)
    setShowSkeleton(false)
    if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = ""
      }
    }
  }, [open])

  const search = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed) {
        if (displayResults.length > 0) {
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

      // Animate out existing results if any
      if (displayResults.length > 0) {
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
      skeletonTimerRef.current = setTimeout(() => setShowSkeleton(true), 500)

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

        // Discard stale response if a newer search was triggered
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
    [displayResults.length],
  )

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newValue = e.target.value
    setQuery(newValue)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(newValue), 300)
  }

  async function loadMore() {
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
  }

  if (!open) return null

  return (
    <div
      className={
        closing ? "animate-overlay-fade-out" : "animate-overlay-fade-in"
      }
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar: search input centered, X on right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "20px 24px 0",
          gap: "16px",
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1 }} />
        <div style={{ width: "100%", maxWidth: "480px" }}>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <svg
                className="h-4 w-4 text-stone-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleChange}
              placeholder="Search videos by keyword..."
              className="w-full rounded-full border border-stone-700 bg-stone-900/80 py-2.5 pl-11 pr-4 text-sm text-stone-100 placeholder-stone-500 outline-none transition focus:border-stone-500"
            />
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-stone-400 transition hover:text-white"
            aria-label="Close search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <line x1={18} y1={6} x2={6} y2={18} />
              <line x1={6} y1={6} x2={18} y2={18} />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable results */}
      <div
        className="search-overlay-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 24px 32px",
          minHeight: 0,
        }}
      >
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          {loading && showSkeleton && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="overflow-hidden rounded-2xl bg-white/5">
                  <div className="aspect-video w-full animate-pulse bg-white/10" />
                  <div className="flex flex-col gap-2 p-3">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-full animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-lg font-semibold text-stone-200">
                No results for &apos;{query.trim()}&apos;
              </h2>
              <p className="mt-2 text-sm text-stone-500">
                Try different keywords or browse experiences
              </p>
            </div>
          )}

          {displayResults.length > 0 && (
            <>
              <div
                key={resultsKey}
                className={`grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4${exiting ? " animate-card-exit" : ""}`}
              >
                {displayResults.map((result, index) => (
                  <div key={`${result.id}-${index}`} onClick={onClose}>
                    <VideoCard result={result} index={exiting ? 0 : index} />
                  </div>
                ))}
              </div>

              {error && (
                <div className="mt-6 text-center">
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    type="button"
                    onClick={loadMore}
                    className="mt-2 rounded-lg bg-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:bg-stone-600"
                  >
                    Retry
                  </button>
                </div>
              )}

              {hasMore && !error && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2 rounded-lg bg-white/10 px-6 py-3 text-sm font-medium text-stone-300 transition hover:bg-white/15 disabled:opacity-50"
                  >
                    {loadingMore && (
                      <svg
                        className="h-4 w-4 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    )}
                    {loadingMore ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
