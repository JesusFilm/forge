import { useEffect, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { SEARCH } from "../lib/queries"
import { BROWSE_TOPICS } from "../lib/browseTopics"
import { pickThumbnailUrl } from "../lib/categoryThumbnail"

// term -> resolved thumbnail URL (null = looked up, none found). Module scope so
// it survives Discover remounts within a session: fetch once, then reuse.
const thumbnailCache = new Map<string, string | null>()

/**
 * Per-session `searchTerm -> URL` map of each browse category's first result
 * thumbnail, rendered faintly over cards as a real-frame context cue. Uses
 * `limit: 1` and reuses the existing anonymous `search` query (no new surface).
 */
export function useCategoryThumbnails(): Record<string, string | null> {
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    () => Object.fromEntries(thumbnailCache),
  )

  useEffect(() => {
    let cancelled = false
    for (const topic of BROWSE_TOPICS) {
      if (thumbnailCache.has(topic.searchTerm)) continue
      getApolloClient()
        .query({
          query: SEARCH,
          variables: {
            q: topic.searchTerm,
            locale: "en",
            limit: 1,
            offset: 0,
          },
          fetchPolicy: "cache-first",
        })
        .then((res) => {
          const url = pickThumbnailUrl(res.data)
          thumbnailCache.set(topic.searchTerm, url)
          if (!cancelled) {
            setThumbnails((prev) => ({ ...prev, [topic.searchTerm]: url }))
          }
        })
        .catch((err) => {
          // Transient failure — leave uncached so a later mount can retry.
          if (__DEV__) {
            console.warn(
              `[useCategoryThumbnails] thumbnail fetch failed for "${topic.searchTerm}"`,
              err,
            )
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [])

  return thumbnails
}
