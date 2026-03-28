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
}

export function createSwrCache<T>({
  fetcher,
  ttlMs,
  maxStaleMs,
  label,
}: SwrCacheOptions<T>) {
  let cached: T | null = null
  let cachedAt = 0
  let refreshPromise: Promise<void> | null = null

  async function doRefresh(): Promise<void> {
    try {
      cached = await fetcher()
      cachedAt = Date.now()
    } catch (error) {
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
        // Deduplicate concurrent refreshes via shared promise
        const promise = refresh()

        // Block if: no cached data yet, OR data exceeds max-stale limit
        if (!cached || isTooOld) {
          await promise
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
