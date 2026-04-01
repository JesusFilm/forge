// Shared stale-while-revalidate cache for API route handlers.
//
// Single-instance assumption: Railway deploys a single Node.js process
// (see railway.toml). Module-scoped state persists across requests for the
// process lifetime. If horizontal scaling is added, move to Redis or
// Railway KV.

type SwrCacheOptions<T> = {
  /** Async function that fetches fresh data */
  fetcher: () => Promise<T>
  /** Time-to-live in milliseconds — triggers background refresh when exceeded */
  ttlMs: number
  /** Maximum age in milliseconds — blocks the request if exceeded */
  maxStaleMs: number
  /** Label for log messages */
  label: string
  /** Minimum gap between refresh retries after a failure */
  failureBackoffMs?: number
}

export function createSwrCache<T>({
  fetcher,
  ttlMs,
  maxStaleMs,
  label,
  failureBackoffMs = 30_000,
}: SwrCacheOptions<T>) {
  let cached: T | null = null
  let cachedAt = 0
  let refreshPromise: Promise<void> | null = null
  let lastFailureAt = 0
  let lastFailureMessage: string | null = null

  async function doRefresh(): Promise<void> {
    try {
      cached = await fetcher()
      cachedAt = Date.now()
      lastFailureAt = 0
      lastFailureMessage = null
    } catch (error) {
      lastFailureAt = Date.now()
      lastFailureMessage =
        error instanceof Error ? error.message : "Unknown refresh error"
      console.error(`[${label}] Background refresh failed:`, error)
      // Stale data preserved — do not update cachedAt so next request retries
      throw error
    }
  }

  function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  return {
    async get(): Promise<T> {
      const now = Date.now()
      const age = now - cachedAt
      const isStale = !cached || age >= ttlMs
      const isTooOld = age >= maxStaleMs

      if (isStale) {
        const inFailureBackoff =
          lastFailureAt > 0 && now - lastFailureAt < failureBackoffMs

        if (inFailureBackoff) {
          if (!cached || isTooOld) {
            throw new Error(
              `[${label}] Refresh suppressed during failure backoff: ${lastFailureMessage ?? "upstream refresh recently failed"}`,
            )
          }
          return cached
        }

        // Deduplicate concurrent refreshes via shared promise
        const promise = refresh()

        // Block if: no cached data yet, OR data exceeds max-stale limit
        if (!cached || isTooOld) {
          await promise
        } else {
          void promise.catch(() => {
            // Background refresh failures are already logged in doRefresh().
            // Swallow here to avoid unhandled rejections when serving stale data.
          })
        }
        // Otherwise: return stale data, refresh runs in background
      }

      if (!cached) {
        throw new Error(
          `[${label}] Cache is empty after refresh — upstream may be down`,
        )
      }

      return cached
    },

    /** Fire-and-forget warm — for use in instrumentation.ts */
    warm(): Promise<void> {
      return refresh().catch(() => {
        // Swallow — warming is best-effort
      })
    },
  }
}
