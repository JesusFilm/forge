"use client"

import {
  parseWatchBootstrapResponse,
  WATCH_BOOTSTRAP_PATH,
  type WatchBootstrapResponse,
} from "@/lib/watch-bootstrap-contract"

let bootstrapRequest: Promise<WatchBootstrapResponse | null> | null = null

function currentCallbackURL(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

/**
 * Single-flight, once-per-document read of `/watch/api/bootstrap`.
 *
 * `AccountControl`, `BetaTesterModalProvider`, and the watch-progress store all
 * call this from their mount effects; they share one request. A successful
 * response is reused for the rest of the document, because sign-in and
 * sign-out are full-page navigations. A failed request resolves `null` and is
 * forgotten, so a later mount (for example `AccountControl` remounting after
 * the search modal closes) retries instead of inheriting the failure.
 */
export function loadWatchBootstrap(): Promise<WatchBootstrapResponse | null> {
  if (bootstrapRequest) return bootstrapRequest

  const url = new URL(WATCH_BOOTSTRAP_PATH, window.location.origin)
  url.searchParams.set("callbackURL", currentCallbackURL())

  const request = fetch(url.toString(), {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) return null
      return parseWatchBootstrapResponse(await response.json())
    })
    .catch(() => null)
    .then((result) => {
      if (result === null && bootstrapRequest === request) {
        bootstrapRequest = null
      }
      return result
    })

  bootstrapRequest = request
  return request
}

export function __resetWatchBootstrapForTests() {
  bootstrapRequest = null
}
