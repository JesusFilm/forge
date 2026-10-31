"use client"

import {
  parseWatchBootstrapResponse,
  WATCH_BOOTSTRAP_PATH,
  type WatchBootstrapResponse,
} from "@/lib/watch-bootstrap-contract"

let bootstrapRequest: Promise<WatchBootstrapResponse | null> | null = null
let cachedBootstrap: WatchBootstrapResponse | null = null
let retryAfter = 0
const UNAVAILABLE_RETRY_MS = 5_000

function complete(bootstrap: WatchBootstrapResponse): boolean {
  return bootstrap.account !== null && bootstrap.watchProgress !== null
}

/** null means no identity was available; undefined means it is not provable. */
function identity(
  bootstrap: WatchBootstrapResponse,
): string | null | undefined {
  const identities: string[] = []
  const { account, watchProgress } = bootstrap
  if (account) {
    if (!account.authenticated) identities.push("guest")
    else if (account.user?.id) identities.push(`user:${account.user.id}`)
  }
  if (watchProgress) {
    identities.push(
      watchProgress.authenticated ? `user:${watchProgress.userId}` : "guest",
    )
  }
  if (identities.length === 0) return account ? undefined : null
  return identities.every((value) => value === identities[0])
    ? identities[0]
    : undefined
}

function retainHealthySections(
  next: WatchBootstrapResponse,
): WatchBootstrapResponse {
  if (!cachedBootstrap) return next
  const nextIdentity = identity(next)
  if (
    nextIdentity === undefined ||
    (nextIdentity !== null && nextIdentity !== identity(cachedBootstrap))
  ) {
    // A confirmed new subject/guest must never inherit another user's data.
    return next
  }
  return {
    contractVersion: next.contractVersion,
    account: next.account ?? cachedBootstrap.account,
    watchProgress: next.watchProgress ?? cachedBootstrap.watchProgress,
  }
}

function currentCallbackURL(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

/**
 * Single-flight read of `/watch/api/bootstrap`, cached for healthy sections.
 *
 * `AccountControl` and the watch-progress store call this from their mount
 * effects; they share one request. A complete response is reused for the
 * document because sign-in/out replace the document. Unavailable sections
 * can recover on a later consumer mount, at most once per five seconds;
 * there is no automatic retry timer. Healthy siblings survive a failed retry
 * only when identity continuity is preserved. An initial whole-request failure
 * remains retryable on the next mount, as before.
 */
export function loadWatchBootstrap(): Promise<WatchBootstrapResponse | null> {
  if (bootstrapRequest) return bootstrapRequest
  if (
    cachedBootstrap &&
    (complete(cachedBootstrap) || Date.now() < retryAfter)
  ) {
    return Promise.resolve(cachedBootstrap)
  }

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
      if (bootstrapRequest !== request) return result
      if (result) cachedBootstrap = retainHealthySections(result)
      retryAfter = Date.now() + UNAVAILABLE_RETRY_MS
      return cachedBootstrap
    })
    .finally(() => {
      if (bootstrapRequest === request) bootstrapRequest = null
    })

  bootstrapRequest = request
  return request
}

export function __resetWatchBootstrapForTests() {
  bootstrapRequest = null
  cachedBootstrap = null
  retryAfter = 0
}
