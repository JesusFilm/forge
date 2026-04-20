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

const hrefBuilder = (result: SearchResult): Route =>
  `/demo-search/${result.slug}/en` as Route

export function DemoSearchResults(props: DemoSearchResultsProps) {
  return (
    <SearchResults
      {...props}
      hrefBuilder={hrefBuilder}
      onQueryTimed={recordQuery}
    />
  )
}
