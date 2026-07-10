"use client"

import { useState } from "react"
import type { Route } from "next"
import { runSearch } from "@/lib/search-actions"
import type { SearchContentType, SearchResult } from "@/lib/search"
import { VideoCard } from "./VideoCard"

type SearchResultsProps = {
  initialResults: SearchResult[]
  initialHasMore: boolean
  query: string
  type?: SearchContentType
  hrefBuilder?: (result: SearchResult) => Route
  onQueryTimed?: (durationMs: number) => void
  showLoadMore?: boolean
}

export function SearchResults({
  initialResults,
  initialHasMore,
  query,
  type,
  hrefBuilder,
  onQueryTimed,
  showLoadMore = true,
}: SearchResultsProps) {
  const [results, setResults] = useState(initialResults)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [offset, setOffset] = useState(initialResults.length)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (initialResults.length === 0) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-lg font-semibold text-stone-100">
          No results for &apos;{query}&apos;
        </h2>
        <p className="mt-2 text-sm text-stone-400">
          Try different keywords or browse videos
        </p>
      </div>
    )
  }

  async function loadMore() {
    setLoading(true)
    setError(null)

    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now()

    try {
      const data = await runSearch({
        query,
        limit: 20,
        offset,
        type,
      })

      const ended =
        typeof performance !== "undefined" ? performance.now() : Date.now()
      onQueryTimed?.(ended - startedAt)

      if (!data.ok) {
        setError(data.error.message)
        return
      }

      setResults((prev) => [...prev, ...data.results])
      setHasMore(data.hasMore)
      setOffset((prev) => data.nextOffset ?? prev + data.results.length)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more results",
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {results.map((result, index) => (
          <VideoCard
            key={`${result.id}-${index}`}
            result={result}
            index={index}
            hrefBuilder={hrefBuilder}
          />
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

      {hasMore && !error && showLoadMore && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-stone-800 px-6 py-3 text-sm font-medium text-stone-200 transition hover:bg-stone-700 disabled:opacity-50"
          >
            {loading && (
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
            {loading ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  )
}
