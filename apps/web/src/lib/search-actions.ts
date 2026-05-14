"use server"

import {
  searchVideos,
  type SearchContentType,
  type SearchResult,
} from "./search"

// Server-action wrapper around `searchVideos` for client-component callers
// (search overlay, load-more button). The browser cannot reach admin
// directly — admin requires a server-side bearer set via WEB_ADMIN_API_KEYS
// — so client-side searches dispatch through this action which runs on the
// Next.js server and forwards to admin.
//
// The "use server" directive limits this file to exporting async functions
// only; the type for the action shape itself lives in search.ts.

export async function runSearch(input: {
  query: string
  limit?: number
  offset?: number
  type?: SearchContentType
}): Promise<{
  results: SearchResult[]
  hasMore: boolean
  query: string
  searchMode: string
  latencyMs: number
}> {
  const { query, limit, offset, type } = input
  return searchVideos(query, limit, offset, type)
}
