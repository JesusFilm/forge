import { useEffect, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { SEARCH } from "../lib/queries"
import { BROWSE_TOPICS } from "../lib/browseTopics"
import { pickThumbnailUrl } from "../lib/categoryThumbnail"

// term -> resolved thumbnail URL (null = looked up, none found). Module scope so
// it survives Discover remounts within a session: fetch once, then reuse.
const thumbnailCache = new Map<string, string | null>()

/**
 * Fetches the first search result's thumbnail for each browse category once and
 * caches it for the session. Returns a `searchTerm -> URL` map; cards render the
 * URL faintly over their gradient so each shows a real video frame as context.
 *
 * Uses `limit: 1` to keep each lookup tiny, and reuses the screen's existing
 * `search` query — no new GraphQL surface, anonymous like every other search.
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
        .catch(() => {
          // Transient failure — leave uncached so a later mount can retry.
        })
    }
    return () => {
      cancelled = true
    }
  }, [])

  return thumbnails
}
