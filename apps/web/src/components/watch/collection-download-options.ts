import {
  buildDownloadFilename,
  buildDownloadProxyUrl,
  resolveDownloadSequence,
  type DownloadSequence,
} from "@/components/watch/download-link"
import {
  bucketDownloads,
  type DownloadTier,
  type WatchDownloadOption,
} from "@/components/watch/download-options"
import { repairLegacyVideoDisplayTitle } from "@forge/content-display"
import type { WatchCollectionDownloadDub } from "@/lib/watch-collection-download-actions"

export type CollectionDownloadEpisode = {
  documentId: string
  order?: number | null
  slug: string | null
  title: string | null
  thumbnailUrl?: string | null
}

export type CollectionDownloadCandidate = {
  documentId: string
  sequence: DownloadSequence | null
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
  const sequenceParent = { children: episodes }

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
      sequence: resolveDownloadSequence(sequenceParent, episode.documentId),
      slug: episode.slug,
      title:
        repairLegacyVideoDisplayTitle({
          title: episode.title,
          slug: episode.slug,
        }) ?? "Video",
      thumbnailUrl: episode.thumbnailUrl ?? null,
      variantId: dub.documentId,
      tiers: Object.fromEntries(
        bucketed.map((option) => [option.tier, option.download]),
      ),
    })
  }

  const commonTiers =
    candidates.length === 0
      ? []
      : TIER_ORDER.filter((tier) =>
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
  const usedFilenames = new Set<string>()
  return input.candidates.flatMap((candidate, candidateIndex) => {
    const download = candidate.tiers[input.tier]
    if (!download) return []
    const filename = uniqueCollectionDownloadFilename(
      buildDownloadFilename({
        languageCode: input.languageCode,
        languageName: input.languageName,
        languageSlug: input.languageSlug,
        renditionHeight: download.height,
        sequence: candidate.sequence,
        tier: input.tier,
        videoSlug: candidate.slug,
        videoTitle: candidate.title,
      }),
      candidate.sequence?.position ?? candidateIndex + 1,
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
