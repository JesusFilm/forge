import { useEffect, useRef, useState } from "react"

import { getApolloClient } from "../../lib/apolloClient"
import { SEMANTIC_SEARCH } from "../../lib/queries"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { CATEGORIES } from "./categories"

// Mirrors apps/mobile useCategoryThumbnails. Module-scope so the six limit:1
// lookups run once per JS session, not per mount — re-entering Search paints
// cached art with zero new calls. null = looked up, none found (no retry).
const thumbnailCache = new Map<string, string | null>()

/**
 * Background image source for each browse-topic card: the first search result's
 * artwork for that category's term, fetched once via the same SEMANTIC_SEARCH
 * the card triggers (capped at limit:1). Returns `{ [searchTerm]: url | null }`;
 * a term stays absent while in flight (card shows its gradient until then).
 */
export function useCategoryThumbnails(): Record<string, string | null> {
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    () => Object.fromEntries(thumbnailCache),
  )
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const client = getApolloClient()

    for (const category of CATEGORIES) {
      if (thumbnailCache.has(category.searchTerm)) continue
      void (async () => {
        try {
          const response = await client.query({
            query: SEMANTIC_SEARCH,
            variables: { query: category.searchTerm, locale: "en", limit: 1 },
            fetchPolicy: "cache-first",
          })
          const url = resolveImageUrl(
            response.data?.semanticSearch?.results?.[0]?.imageUrl,
          )
          thumbnailCache.set(category.searchTerm, url)
          if (!mountedRef.current) return
          setThumbnails((prev) => ({ ...prev, [category.searchTerm]: url }))
        } catch (error) {
          // Leave the term uncached so a later mount retries it.
          if (__DEV__) {
            console.warn(
              "[search] category thumbnail fetch failed:",
              category.searchTerm,
              error,
            )
          }
        }
      })()
    }

    return () => {
      mountedRef.current = false
    }
  }, [])

  return thumbnails
}
