"use client"

import { useEffect, useRef } from "react"
import type { Route } from "next"
import { SearchResults } from "@/components/search/SearchResults"
import { recordQuery } from "@/lib/demo-search-metrics"
import type { SearchResult } from "@/lib/search"

type DemoSearchResultsProps = {
  initialResults: SearchResult[]
  initialHasMore: boolean
  query: string
  initialLatencyMs?: number
}

// Videos open in the demo player (with scene recommendations underneath).
// Experiences open in the canonical experience renderer at /[slug]/[locale]
// — the demo doesn't ship its own experience tree renderer, and reusing the
// real one means cross-product navigation continues to work from the demo.
const hrefBuilder = (result: SearchResult): Route =>
  result.type === "experience"
    ? (`/${result.slug}/en` as Route)
    : (`/demo-search/${result.slug}/en` as Route)

export function DemoSearchResults({
  initialLatencyMs,
  ...rest
}: DemoSearchResultsProps) {
  // Record the server-measured latency of the initial SSR fetch once per
  // query. The SearchResults "Load more" client fetch adds its own samples
  // via onQueryTimed. The effect keys on query so re-queries record too.
  const recordedRef = useRef<string | null>(null)
  useEffect(() => {
    if (initialLatencyMs == null) return
    if (recordedRef.current === rest.query) return
    recordedRef.current = rest.query
    recordQuery(initialLatencyMs)
  }, [rest.query, initialLatencyMs])

  return (
    <SearchResults
      {...rest}
      hrefBuilder={hrefBuilder}
      onQueryTimed={recordQuery}
    />
  )
}
