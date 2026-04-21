"use client"

import type { Route } from "next"
import { SearchResults } from "@/components/search/SearchResults"
import { recordQuery } from "@/lib/demo-search-metrics"
import type { SearchResult } from "@/lib/search"

type DemoSearchResultsProps = {
  initialResults: SearchResult[]
  initialHasMore: boolean
  query: string
}

// Videos open in the demo player (with scene recommendations underneath).
// Experiences open in the canonical experience renderer at /[slug]/[locale]
// — the demo doesn't ship its own experience tree renderer, and reusing the
// real one means cross-product navigation continues to work from the demo.
const hrefBuilder = (result: SearchResult): Route =>
  result.type === "experience"
    ? (`/${result.slug}/en` as Route)
    : (`/demo-search/${result.slug}/en` as Route)

export function DemoSearchResults(props: DemoSearchResultsProps) {
  return (
    <SearchResults
      {...props}
      hrefBuilder={hrefBuilder}
      onQueryTimed={recordQuery}
    />
  )
}
