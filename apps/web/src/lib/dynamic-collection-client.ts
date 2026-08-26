"use client"

import {
  DynamicCollectionFeedRequestError,
  DynamicCollectionFeedValidationError,
  WATCH_COLLECTION_FEED_MAX_URL_LENGTH,
  normalizeDynamicCollectionFeedInput,
  parseDynamicCollectionFeedPage,
  type DynamicCollectionFeedInput,
  type DynamicCollectionFeedPage,
} from "@/lib/dynamic-collection-contract"
import { watchPath } from "@/lib/watch-paths"

const DYNAMIC_COLLECTION_FEED_TIMEOUT_MS = 10_000

function boundedRetryAfterSeconds(value: string | null): number {
  const seconds = value?.match(/^\d+$/) ? Number(value) : Number.NaN
  return Number.isFinite(seconds) ? Math.min(300, Math.max(1, seconds)) : 60
}

export async function loadDynamicCollectionFeedPage(
  input: DynamicCollectionFeedInput,
  options: { signal?: AbortSignal } = {},
): Promise<DynamicCollectionFeedPage> {
  const normalized = normalizeDynamicCollectionFeedInput(input)
  const params = new URLSearchParams({
    locale: normalized.locale,
    languageSlug: normalized.languageSlug,
    first: String(normalized.first),
    cardsPerParent: String(normalized.cardsPerParent),
  })
  if (normalized.cacheScope === "preview") params.set("scope", "preview")
  if (normalized.after) params.set("after", normalized.after)
  for (const id of normalized.excludedIds) params.append("excludedIds", id)
  for (const slug of normalized.excludedSlugs) {
    params.append("excludedSlugs", slug)
  }

  const href = `${watchPath("/api/dynamic-collections")}?${params}`
  if (href.length >= WATCH_COLLECTION_FEED_MAX_URL_LENGTH) {
    throw new DynamicCollectionFeedValidationError(
      "request",
      "Collection feed request is too large",
    )
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abortFromCaller()
  else
    options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, DYNAMIC_COLLECTION_FEED_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(href, {
      cache: "no-store",
      headers: { accept: "application/json" },
      method: "GET",
      signal: controller.signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new DynamicCollectionFeedRequestError(
      timedOut ? "timeout" : "transport",
    )
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }

  if (response.status === 429) {
    throw new DynamicCollectionFeedRequestError(
      "rate_limited",
      boundedRetryAfterSeconds(response.headers.get("retry-after")),
    )
  }
  if (!response.ok) throw new DynamicCollectionFeedRequestError("http")

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new DynamicCollectionFeedValidationError(
      "response",
      "Invalid collection feed response",
    )
  }
  return parseDynamicCollectionFeedPage(payload, normalized)
}
