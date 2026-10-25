import { useEffect, useState } from "react"

import { getApolloClient } from "../../lib/apolloClient"
import { WATCH_SEARCH } from "../../lib/queries"
import {
  buildWatchSearchInput,
  mapWatchSearchResponse,
} from "../../lib/watchSearch"
import { pickThumbnailUrl } from "./categoryThumbnail"
import { CATEGORIES } from "./categories"

/** Scanned for the first result with artwork; the top hit can be imageless. */
const THUMBNAIL_SCAN_LIMIT = 5

// Module-scope so the six lookups run once per JS session, not per mount.
// null = looked up, none usable (no retry). Mobile's version is still the
// #1622 no-op shim this replaced on TV.
const thumbnailCache = new Map<string, string | null>()

// Claimed synchronously before dispatch so a remount can't refire a live
// request. Holds the PROMISE, not just the term: a mount that arrives mid-flight
// attaches to it, instead of skipping and never learning the result.
const inFlight = new Map<string, Promise<string | null>>()

/**
 * `{ [searchTerm]: url | null }` backing each browse-topic card, fetched once
 * per session via the same public watchSearch op the card triggers. A term stays
 * absent while in flight, so the card shows its gradient until then.
 */
export function useCategoryThumbnails(): Record<string, string | null> {
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    () => Object.fromEntries(thumbnailCache),
  )

  useEffect(() => {
    // Local flag, not a hook-lifetime ref: cleanup can't poison a later mount.
    let cancelled = false

    // A remount reads a cache an earlier mount may have filled after this
    // instance's initializer ran; publish it so cards repaint immediately
    // rather than waiting on a fetch the cache check below will skip.
    if (thumbnailCache.size > 0) {
      setThumbnails((prev) => ({
        ...Object.fromEntries(thumbnailCache),
        ...prev,
      }))
    }

    for (const category of CATEGORIES) {
      const term = category.searchTerm
      if (thumbnailCache.has(term)) continue

      let lookup = inFlight.get(term)
      if (!lookup) {
        lookup = getApolloClient()
          .query({
            query: WATCH_SEARCH,
            variables: {
              input: buildWatchSearchInput({
                query: term,
                limit: THUMBNAIL_SCAN_LIMIT,
                offset: 0,
              }),
            },
            fetchPolicy: "cache-first",
          })
          .then((response) => {
            const url = pickThumbnailUrl(
              mapWatchSearchResponse(response.data?.watchSearch, term, 0)
                .results,
            )
            thumbnailCache.set(term, url)
            return url
          })
          .finally(() => {
            inFlight.delete(term)
          })
        inFlight.set(term, lookup)
      }

      // Every live mount awaits the shared lookup, so a mount that arrived
      // mid-flight still paints instead of waiting for a third mount.
      lookup
        .then((url) => {
          if (!cancelled) setThumbnails((prev) => ({ ...prev, [term]: url }))
        })
        .catch((error) => {
          // Transient failure — leave uncached so a later mount can retry.
          if (__DEV__) {
            console.warn(
              `[search] category thumbnail fetch failed for "${term}"`,
              error,
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
