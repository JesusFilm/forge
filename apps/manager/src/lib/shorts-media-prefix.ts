// 60s in-process cache of jobId → shorts storage prefix for the media
// streaming route (plan 2026-06-11-002 decision 6). Video elements issue
// many Range requests per playback session; without this cache every seek
// pays a getJob round trip to the admin backend.
//
// `null` is cached too (unknown job / not a shorts job) so a misbehaving
// client cannot hammer getJob with a bogus id. Artifacts live under
// options.shorts.assetId, which is immutable for the life of a job, so a
// 60s TTL can never serve a wrong prefix — the TTL only bounds memory and
// lets deleted jobs age out.

import { getJobArtifactStorageAssetId } from "@/lib/job-artifacts"
import { getJob } from "@/lib/state"

const PREFIX_CACHE_TTL_MS = 60_000

type PrefixCacheEntry = {
  prefix: string | null
  expiresAt: number
}

const prefixCache = new Map<string, PrefixCacheEntry>()

export async function resolveShortsMediaPrefix(
  jobId: string,
  now: () => number = Date.now,
): Promise<string | null> {
  const cached = prefixCache.get(jobId)
  if (cached && cached.expiresAt > now()) {
    return cached.prefix
  }

  const job = await getJob(jobId)
  const prefix =
    job && job.options.shorts ? getJobArtifactStorageAssetId(job) : null
  prefixCache.set(jobId, { prefix, expiresAt: now() + PREFIX_CACHE_TTL_MS })
  return prefix
}

// Test helper — route tests assert cache hits via getJob mock call counts.
export function clearShortsMediaPrefixCache(): void {
  prefixCache.clear()
}
