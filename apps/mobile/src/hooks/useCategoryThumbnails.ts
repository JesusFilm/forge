import { useEffect, useState } from "react"

import { BROWSE_TOPICS } from "../lib/browseTopics"

// term -> resolved thumbnail URL (null = looked up, none found). Module scope so
// it survives Discover remounts within a session: fetch once, then reuse.
const thumbnailCache = new Map<string, string | null>()

/**
 * Per-session `searchTerm -> URL` map of each browse category's first result
 * thumbnail. Temporarily no-ops while Watch search is rebuilt for web first, so
 * mobile does not depend on Admin's legacy Query.search contract.
 */
export function useCategoryThumbnails(): Record<string, string | null> {
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    () => Object.fromEntries(thumbnailCache),
  )

  useEffect(() => {
    const next: Record<string, string | null> = {}
    for (const topic of BROWSE_TOPICS) {
      if (thumbnailCache.has(topic.searchTerm)) continue
      thumbnailCache.set(topic.searchTerm, null)
      next[topic.searchTerm] = null
    }
    if (Object.keys(next).length > 0) {
      setThumbnails((prev) => ({ ...prev, ...next }))
    }
  }, [])

  return thumbnails
}
