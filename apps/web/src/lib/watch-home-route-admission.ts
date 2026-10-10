import { logWatchServerEvent } from "./watch-observability"

export type WatchHomepageAvailability = "available" | "missing" | "unknown"
export type WatchHomepageAvailabilitySource = (
  locale: string,
) => Promise<WatchHomepageAvailability>

const CACHE_TTL_MS = 60_000
const REQUEST_TIMEOUT_MS = 3_000
const WATCH_HOMEPAGE_AVAILABILITY_QUERY = `
  query WatchHomepageAvailability($locale: String!) {
    watchSetting(locale: $locale) {
      homepageExperience {
        id
      }
    }
  }
`

type CacheEntry = {
  expiresAt: number
  value: Exclude<WatchHomepageAvailability, "unknown">
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<WatchHomepageAvailability>>()
let sourceOverride: WatchHomepageAvailabilitySource | null = null

function adminGraphqlUrl(): string | null {
  const raw = process.env.ADMIN_GRAPHQL_URL
  if (!raw) return null
  try {
    return new URL(raw).toString()
  } catch {
    return null
  }
}

function adminBearer(): string | null {
  const bearer = process.env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim()
  return bearer || null
}

async function fetchWatchHomepageAvailability(
  locale: string,
): Promise<WatchHomepageAvailability> {
  const url = adminGraphqlUrl()
  if (!url) return "unknown"

  const bearer = adminBearer()
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({
        query: WATCH_HOMEPAGE_AVAILABILITY_QUERY,
        variables: { locale },
      }),
      signal:
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          : undefined,
    })

    if (!response.ok) {
      logWatchServerEvent("watch_home_admission.fetch.failed", {
        locale,
        status: response.status,
      })
      return "unknown"
    }

    const payload = (await response.json()) as {
      data?: {
        watchSetting?: {
          homepageExperience?: { id?: unknown } | null
        } | null
      }
      errors?: unknown[]
    }
    if (payload.errors?.length || !payload.data) {
      logWatchServerEvent("watch_home_admission.fetch.graphql_error", {
        locale,
      })
      return "unknown"
    }

    const setting = payload.data.watchSetting
    if (setting?.homepageExperience === null || setting === null) {
      return "missing"
    }
    return typeof setting?.homepageExperience?.id === "string"
      ? "available"
      : "unknown"
  } catch (error) {
    logWatchServerEvent("watch_home_admission.fetch.error", {
      locale,
      detail: error instanceof Error ? error.message : String(error),
    })
    return "unknown"
  }
}

export function clearWatchHomepageAvailabilityCache(): void {
  cache.clear()
  inFlight.clear()
}

export function setWatchHomepageAvailabilitySourceForTest(
  source: WatchHomepageAvailabilitySource | null,
): () => void {
  const previous = sourceOverride
  sourceOverride = source
  clearWatchHomepageAvailabilityCache()
  return () => {
    sourceOverride = previous
    clearWatchHomepageAvailabilityCache()
  }
}

export async function getWatchHomepageAvailability(
  locale: string,
): Promise<WatchHomepageAvailability> {
  const now = Date.now()
  const cached = cache.get(locale)
  if (cached && cached.expiresAt > now) return cached.value

  const pending = inFlight.get(locale)
  if (pending) return pending

  const source = sourceOverride ?? fetchWatchHomepageAvailability
  const request = source(locale)
    .then((value) => {
      if (value !== "unknown") {
        cache.set(locale, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          value,
        })
      }
      return value
    })
    .finally(() => {
      inFlight.delete(locale)
    })
  inFlight.set(locale, request)
  return request
}
