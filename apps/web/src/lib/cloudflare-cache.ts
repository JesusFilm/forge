import "server-only"

import { env } from "@/env"
import type { DynamicCollectionFeedCacheScope } from "@/lib/dynamic-collection-contract"

export const WATCH_DYNAMIC_COLLECTIONS_CACHE_TAG = "watch-dynamic-collections"

const LIVE_EDGE_CACHE_CONTROL =
  "public, max-age=21600, stale-while-revalidate=86400"
const CLOUDFLARE_PURGE_TIMEOUT_MS = 3_000

type CloudflareCachePurgeOutcome = "skipped" | "purged" | "failed"

function isCloudflareCachePurgeConfigured(): boolean {
  return Boolean(env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_CACHE_PURGE_TOKEN)
}

export function dynamicCollectionEdgeCacheHeaders(
  scope: DynamicCollectionFeedCacheScope,
  canonicalSignedVariant: boolean,
): Record<string, string> {
  if (
    scope !== "live" ||
    !canonicalSignedVariant ||
    !isCloudflareCachePurgeConfigured()
  ) {
    return {}
  }

  return {
    "Cloudflare-CDN-Cache-Control": LIVE_EDGE_CACHE_CONTROL,
    "Cache-Tag": WATCH_DYNAMIC_COLLECTIONS_CACHE_TAG,
  }
}

function logPurgeFailure(): void {
  console.warn("[watch] event=dynamic_collection_feed.edge_cache.purge.failed")
}

export async function purgeWatchDynamicCollectionsCache(): Promise<CloudflareCachePurgeOutcome> {
  if (!isCloudflareCachePurgeConfigured()) return "skipped"

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_CACHE_PURGE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tags: [WATCH_DYNAMIC_COLLECTIONS_CACHE_TAG],
        }),
        signal: AbortSignal.timeout(CLOUDFLARE_PURGE_TIMEOUT_MS),
      },
    )
    if (!response.ok) {
      logPurgeFailure()
      return "failed"
    }

    const payload: unknown = await response.json()
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("success" in payload) ||
      payload.success !== true
    ) {
      logPurgeFailure()
      return "failed"
    }

    return "purged"
  } catch {
    logPurgeFailure()
    return "failed"
  }
}
