import { useEffect, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { WATCH_SEARCH } from "../lib/queries"
import { BROWSE_TOPICS } from "../lib/browseTopics"
import { pickThumbnailUrl } from "../lib/categoryThumbnail"
import {
  buildWatchSearchInput,
  mapWatchSearchResponse,
} from "../lib/watchSearch"

/** Scanned for the first result with artwork; the top hit can be imageless. */
const THUMBNAIL_SCAN_LIMIT = 5

/**
 * Backoff after a failed lookup. Browse unmounts on every search and remounts on
 * clear, so without this a flaky network re-fires six bearer-carrying queries per
 * cycle against the device's shared search budget. Mirrors heroStreamCooldown.
 */
const FAILURE_COOLDOWN_MS = 60_000

// term -> resolved thumbnail URL (null = looked up, none found). Module scope so
// it survives Discover remounts within a session: fetch once, then reuse.
const thumbnailCache = new Map<string, string | null>()

// Claimed synchronously before dispatch so a remount can't refire an in-flight
// request. Released in finally.
const inFlight = new Set<string>()

/** term -> epoch ms when a retry is allowed again. */
const retryAfter = new Map<string, number>()

// Live subscribers, so a fetch started by one mount publishes to whichever mount
// is alive when it resolves — the dispatching effect is often already gone.
type Publish = (term: string, url: string | null) => void
const subscribers = new Set<Publish>()

/**
 * Per-session `searchTerm -> URL` map of each browse category's first result
 * WITH artwork (scanned by pickThumbnailUrl), rendered blurred behind the
 * gradient cards as a real-frame context cue. Reuses the public watchSearch
 * operation — no new admin surface.
 */
export function useCategoryThumbnails(): Record<string, string | null> {
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    () => Object.fromEntries(thumbnailCache),
  )

  useEffect(() => {
    const publish: Publish = (term, url) =>
      setThumbnails((prev) => ({ ...prev, [term]: url }))
    subscribers.add(publish)

    // Adopt anything an earlier mount already resolved.
    if (thumbnailCache.size > 0) {
      setThumbnails((prev) => ({
        ...Object.fromEntries(thumbnailCache),
        ...prev,
      }))
    }

    const now = Date.now()
    for (const topic of BROWSE_TOPICS) {
      const term = topic.searchTerm
      if (thumbnailCache.has(term) || inFlight.has(term)) continue
      if ((retryAfter.get(term) ?? 0) > now) continue
      inFlight.add(term)
      // Promise.resolve().then defers the client call so a SYNCHRONOUS throw
      // still lands in .catch — otherwise the chain never attaches and the
      // inFlight slot leaks for the rest of the session.
      Promise.resolve()
        .then(() =>
          getApolloClient().query({
            query: WATCH_SEARCH,
            variables: {
              input: buildWatchSearchInput({
                query: term,
                limit: THUMBNAIL_SCAN_LIMIT,
                offset: 0,
              }),
            },
            fetchPolicy: "cache-first",
          }),
        )
        .then((res) => {
          const page = mapWatchSearchResponse(res.data?.watchSearch, term, 0)
          const url = pickThumbnailUrl(page.results)
          thumbnailCache.set(term, url)
          retryAfter.delete(term)
          // Notify whoever is mounted NOW, not just the effect that dispatched.
          for (const notify of subscribers) notify(term, url)
        })
        .catch((err) => {
          // Leave uncached so it can retry, but not before the cooldown.
          retryAfter.set(term, Date.now() + FAILURE_COOLDOWN_MS)
          if (__DEV__) {
            console.warn(
              `[useCategoryThumbnails] thumbnail fetch failed for "${term}"`,
              err,
            )
          }
        })
        .finally(() => {
          inFlight.delete(term)
        })
    }

    return () => {
      subscribers.delete(publish)
    }
  }, [])

  return thumbnails
}
