import {
  buildDownloadFilename,
  buildDownloadProxyUrl,
} from "@/components/watch/download-link"
import {
  bucketDownloads,
  type DownloadTier,
  type WatchDownloadOption,
} from "@/components/watch/download-options"
import type { WatchCollectionDownloadDub } from "@/lib/watch-collection-download-actions"

export type CollectionDownloadEpisode = {
  documentId: string
  slug: string | null
  title: string | null
}

export type CollectionDownloadCandidate = {
  documentId: string
  slug: string
  title: string
  variantId: string
  tiers: Partial<Record<DownloadTier, WatchDownloadOption>>
}

export type CollectionDownloadOptions = {
  candidates: CollectionDownloadCandidate[]
  skipped: CollectionDownloadEpisode[]
  commonTiers: DownloadTier[]
}

const TIER_ORDER: DownloadTier[] = ["highest", "high", "low"]

export function buildCollectionDownloadOptions(
  episodes: CollectionDownloadEpisode[],
  dubs: WatchCollectionDownloadDub[],
): CollectionDownloadOptions {
  const dubByVideoId = new Map(dubs.map((dub) => [dub.videoId, dub]))
  const candidates: CollectionDownloadCandidate[] = []
  const skipped: CollectionDownloadEpisode[] = []

  for (const episode of episodes) {
    const dub = dubByVideoId.get(episode.documentId)
    if (!dub || !episode.slug) {
      skipped.push(episode)
      continue
    }
    const bucketed = bucketDownloads(dub.downloads)
    if (bucketed.length === 0) {
      skipped.push(episode)
      continue
    }
    candidates.push({
      documentId: episode.documentId,
      slug: episode.slug,
      title: episode.title ?? episode.slug,
      variantId: dub.documentId,
      tiers: Object.fromEntries(
        bucketed.map((option) => [option.tier, option.download]),
      ),
    })
  }

  const commonTiers = TIER_ORDER.filter((tier) =>
    candidates.every((candidate) => candidate.tiers[tier] != null),
  )
  return { candidates, skipped, commonTiers }
}

export type CollectionDownloadQueueItem = {
  id: string
  filename: string
  title: string
  url: string
}

export function buildCollectionDownloadQueue(input: {
  candidates: CollectionDownloadCandidate[]
  tier: DownloadTier
  languageCode?: string | null
  languageName?: string | null
  languageSlug: string
}): CollectionDownloadQueueItem[] {
  return input.candidates.flatMap((candidate) => {
    const download = candidate.tiers[input.tier]
    if (!download) return []
    const filename = buildDownloadFilename({
      languageCode: input.languageCode,
      languageName: input.languageName,
      languageSlug: input.languageSlug,
      renditionHeight: download.height,
      tier: input.tier,
      videoSlug: candidate.slug,
      videoTitle: candidate.title,
    })
    return [
      {
        id: candidate.documentId,
        filename,
        title: candidate.title,
        url: buildDownloadProxyUrl({
          downloadId: download.documentId,
          filename,
          variantId: candidate.variantId,
          videoSlug: candidate.slug,
        }),
      },
    ]
  })
}
