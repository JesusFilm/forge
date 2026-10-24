"use client"

import { useEffect, useRef } from "react"
import { SearchResults } from "@/components/search/SearchResults"
import { demoResultHref } from "@/lib/demo-href"
import { recordQuery } from "@/lib/demo-search-metrics"
import type { SearchResult } from "@/lib/search"

type DemoSearchResultsProps = {
  initialResults: SearchResult[]
  initialHasMore: boolean
  query: string
  initialLatencyMs?: number
}

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
      type="video"
      hrefBuilder={demoResultHref}
      onQueryTimed={recordQuery}
      showLoadMore={false}
    />
  )
}
