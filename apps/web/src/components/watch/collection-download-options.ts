import {
  buildDownloadFilename,
  buildDownloadProxyUrl,
} from "@/components/watch/download-link"
import {
  bucketDownloads,
  type DownloadTier,
  type WatchDownloadOption,
} from "@/components/watch/download-options"
import type {
  WatchCollectionDownloadLeaf,
  WatchCollectionDownloadSkippedLeaf,
} from "@/lib/watch-collection-download-actions"

type WatchCollectionDownloadDub = {
  documentId: string
  videoId: string
  downloads: WatchCollectionDownloadLeaf["downloads"]
}

export type CollectionDownloadEpisode = {
  documentId: string
  slug: string | null
  title: string | null
  thumbnailUrl?: string | null
}

export type CollectionDownloadCandidate = {
  documentId: string
  slug: string
  title: string
  thumbnailUrl: string | null
  variantId: string
  tiers: Partial<Record<DownloadTier, WatchDownloadOption>>
}

export type CollectionDownloadOptions = {
  candidates: CollectionDownloadCandidate[]
  skipped: CollectionDownloadEpisode[]
  commonTiers: DownloadTier[]
}

const TIER_ORDER: DownloadTier[] = ["highest", "high", "low"]
const DOWNLOAD_FILENAME_EXTENSION = ".mp4"
const MAX_DOWNLOAD_FILENAME_LENGTH = 200

function commonCollectionDownloadTiers(
  candidates: CollectionDownloadCandidate[],
): DownloadTier[] {
  if (candidates.length === 0) return []
  return TIER_ORDER.filter((tier) =>
    candidates.every((candidate) => candidate.tiers[tier] != null),
  )
}

function uniqueCollectionDownloadFilename(
  filename: string,
  ordinal: number,
  usedFilenames: Set<string>,
): string {
  if (!usedFilenames.has(filename)) {
    usedFilenames.add(filename)
    return filename
  }

  const basename = filename.slice(0, -DOWNLOAD_FILENAME_EXTENSION.length)
  let attempt = 1
  while (true) {
    const suffix = `_${ordinal}${attempt === 1 ? "" : `-${attempt}`}`
    const maxBasenameLength =
      MAX_DOWNLOAD_FILENAME_LENGTH -
      DOWNLOAD_FILENAME_EXTENSION.length -
      suffix.length
    const trimmedBasename =
      basename.slice(0, maxBasenameLength).replace(/[._-]+$/g, "") || "video"
    const uniqueFilename = `${trimmedBasename}${suffix}${DOWNLOAD_FILENAME_EXTENSION}`
    if (!usedFilenames.has(uniqueFilename)) {
      usedFilenames.add(uniqueFilename)
      return uniqueFilename
    }
    attempt += 1
  }
}

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
      thumbnailUrl: episode.thumbnailUrl ?? null,
      variantId: dub.documentId,
      tiers: Object.fromEntries(
        bucketed.map((option) => [option.tier, option.download]),
      ),
    })
  }

  return {
    candidates,
    skipped,
    commonTiers: commonCollectionDownloadTiers(candidates),
  }
}

export function buildCollectionDownloadOptionsFromDescendants(
  leaves: WatchCollectionDownloadLeaf[],
  skippedLeaves: WatchCollectionDownloadSkippedLeaf[],
): CollectionDownloadOptions {
  const seen = new Set<string>()
  const candidates = leaves
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .flatMap((leaf) => {
      if (seen.has(leaf.documentId)) return []
      seen.add(leaf.documentId)
      const bucketed = bucketDownloads(leaf.downloads)
      if (bucketed.length === 0) return []
      return [
        {
          documentId: leaf.documentId,
          slug: leaf.slug,
          title: leaf.title,
          thumbnailUrl: leaf.thumbnailUrl,
          variantId: leaf.variantId,
          tiers: Object.fromEntries(
            bucketed.map((option) => [option.tier, option.download]),
          ),
        } satisfies CollectionDownloadCandidate,
      ]
    })
  const skipped = skippedLeaves.flatMap((leaf) =>
    seen.has(leaf.documentId)
      ? []
      : [
          {
            documentId: leaf.documentId,
            slug: leaf.slug,
            title: leaf.title,
            thumbnailUrl: leaf.thumbnailUrl,
          },
        ],
  )
  return {
    candidates,
    skipped,
    commonTiers: commonCollectionDownloadTiers(candidates),
  }
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
  const usedFilenames = new Set<string>()
  return input.candidates.flatMap((candidate, index) => {
    const download = candidate.tiers[input.tier]
    if (!download) return []
    const filename = uniqueCollectionDownloadFilename(
      buildDownloadFilename({
        languageCode: input.languageCode,
        languageName: input.languageName,
        languageSlug: input.languageSlug,
        renditionHeight: download.height,
        tier: input.tier,
        videoSlug: candidate.slug,
        videoTitle: candidate.title,
      }),
      index + 1,
      usedFilenames,
    )
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
