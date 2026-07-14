import { useEffect, useRef, useState } from "react"

import { getApolloClient } from "../../lib/apolloClient"
import { SEMANTIC_SEARCH } from "../../lib/queries"
import { pickThumbnailUrl } from "./categoryThumbnail"
import { CATEGORIES } from "./categories"

// Mirrors apps/mobile useCategoryThumbnails. Module-scope so the six lookups run
// once per JS session, not per mount — re-entering Search paints cached art with
// zero new calls. null = looked up, none usable (no retry).
const thumbnailCache = new Map<string, string | null>()

/**
 * Background image source for each browse-topic card: the first search result
 * WITH artwork for that category's term (limit:5, scanned by pickThumbnailUrl —
 * the top hit can be imageless, e.g. "christmas"), fetched once via the same
 * SEMANTIC_SEARCH the card triggers. Returns `{ [searchTerm]: url | null }`; a
 * term stays absent while in flight (card shows its gradient until then).
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
            variables: { query: category.searchTerm, locale: "en", limit: 5 },
            fetchPolicy: "cache-first",
          })
          const url = pickThumbnailUrl(response.data)
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
