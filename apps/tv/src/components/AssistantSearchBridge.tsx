// Routes Google Assistant app-search queries ("search for X on Jesus Film
// Watch") into /search. Android-only by construction: the tv-search-intent
// module no-ops everywhere else, so this renders nothing and subscribes to
// nothing on tvOS. The spoken text rides the q param VERBATIM — the search
// screen's write site (runQueryImmediate → sanitizeQuery) is the chokepoint.

import { useEffect } from "react"
import { useNavigationContainerRef, useRouter } from "expo-router"

import {
  addSearchIntentListener,
  consumeLaunchSearchQuery,
} from "../../modules/tv-search-intent"

/** 50ms × 100 ≈ 5s: far beyond any real mount; then give up quietly. */
const READY_POLL_MS = 50
const READY_POLL_MAX_ATTEMPTS = 100

export function AssistantSearchBridge() {
  const router = useRouter()
  // Gate on the SAME predicate router.navigate throws on: the root navigation
  // container's isReady(). A cold Assistant launch fires this effect before
  // the sibling <Stack> commits, and useRootNavigationState's `key` turns
  // non-null BEFORE the ref is ready — gating on `key` still crashed with
  // "Attempted to navigate before mounting the Root Layout" on a real
  // Chromecast. Polling isReady() is the layer the error actually lives at.
  const navigationRef = useNavigationContainerRef()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const navigateWhenReady = (query: string, attempt: number = 0) => {
      if (cancelled) return
      if (navigationRef.isReady()) {
        router.navigate({ pathname: "/search", params: { q: query } })
        return
      }
      if (attempt >= READY_POLL_MAX_ATTEMPTS) return
      timer = setTimeout(
        () => navigateWhenReady(query, attempt + 1),
        READY_POLL_MS,
      )
    }

    // Cold start: the launch intent carried the query (one-shot read).
    const launchQuery = consumeLaunchSearchQuery()
    if (launchQuery != null) navigateWhenReady(launchQuery)

    // Warm arrivals while the app is already running (OnNewIntent).
    // router.navigate (not push) so a repeat Assistant search updates the
    // EXISTING /search screen's params instead of stacking another copy.
    const subscription = addSearchIntentListener(({ query }) => {
      navigateWhenReady(query)
    })

    return () => {
      cancelled = true
      if (timer != null) clearTimeout(timer)
      subscription.remove()
    }
  }, [navigationRef, router])

  return null
}
