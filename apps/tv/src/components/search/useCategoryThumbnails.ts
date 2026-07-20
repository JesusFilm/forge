import { useEffect, useRef, useState } from "react"

import { CATEGORIES } from "./categories"

// Mirrors apps/mobile useCategoryThumbnails. Module-scope so the six lookups run
// once per JS session, not per mount. null = looked up, none usable (no retry).
const thumbnailCache = new Map<string, string | null>()

/**
 * Background image source for each browse-topic card. Temporarily no-ops while
 * Watch search is rebuilt for web first. Returns `{ [searchTerm]: url | null }`;
 * null lets the card keep its gradient fallback.
 */
export function useCategoryThumbnails(): Record<string, string | null> {
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    () => Object.fromEntries(thumbnailCache),
  )
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const next: Record<string, string | null> = {}

    for (const category of CATEGORIES) {
      if (thumbnailCache.has(category.searchTerm)) continue
      thumbnailCache.set(category.searchTerm, null)
      next[category.searchTerm] = null
    }

    if (mountedRef.current && Object.keys(next).length > 0) {
      setThumbnails((prev) => ({ ...prev, ...next }))
    }

    return () => {
      mountedRef.current = false
    }
  }, [])

  return thumbnails
}
