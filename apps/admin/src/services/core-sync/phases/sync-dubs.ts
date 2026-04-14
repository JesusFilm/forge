// Sync phase: video-dubs (formerly video-variants in Core)
//
// Boundary translation: Core's `videoVariant` → admin's `VideoDub`.
// The varying axis is the audio language (a dub), not the frames.
// Depends on: videos, languages

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { emptySyncStats } from "../types"

const DUBS_QUERY = `
  query VideoVariants($offset: Int!, $limit: Int!, $since: String) {
    videoVariants(
      offset: $offset
      limit: $limit
      where: { updatedAt_gt: $since }
    ) {
      id
      videoId
      slug
      languageId
      duration
      lengthInMilliseconds
      hls
      dash
      share
      downloadable
      published
      updatedAt
    }
  }
`

type CoreVariant = {
  id: string
  videoId: string
  slug: string | null
  languageId: string | null
  duration: number
  lengthInMilliseconds: string | null
  hls: string | null
  dash: string | null
  share: string | null
  downloadable: boolean
  published: boolean
  updatedAt: string
}

export async function syncDubs({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }

  // Build lookup maps
  const videos = await prisma.video.findMany({
    select: { id: true, coreId: true },
  })
  const videoMap = new Map(videos.map((v) => [v.coreId, v.id]))

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const PAGE_SIZE = 500
  let offset = 0

  while (true) {
    const result = await coreQuery<{ videoVariants: CoreVariant[] }>(
      DUBS_QUERY,
      { offset, limit: PAGE_SIZE, since: since ?? null },
    )

    const variants = result.data?.videoVariants ?? []
    if (variants.length === 0) break
    progress.setTotal(offset + variants.length)

    for (const v of variants) {
      try {
        const videoId = videoMap.get(v.videoId)
        if (!videoId) {
          stats.errors++
          progress.increment()
          continue
        }

        // Short-circuit: never overwrite source='manager' dubs
        const existingDub = await prisma.videoDub.findUnique({
          where: { coreId: v.id },
          select: { source: true },
        })
        if (existingDub?.source === "MANAGER") {
          progress.increment()
          continue
        }

        const languageId = v.languageId
          ? (langMap.get(v.languageId) ?? null)
          : null

        await prisma.videoDub.upsert({
          where: { coreId: v.id },
          create: {
            coreId: v.id,
            videoId,
            slug: v.slug,
            duration: v.duration,
            lengthInMilliseconds: v.lengthInMilliseconds
              ? BigInt(v.lengthInMilliseconds)
              : null,
            hls: v.hls,
            dash: v.dash,
            share: v.share,
            downloadable: v.downloadable,
            published: v.published,
            source: "CORE",
            ...(languageId ? { languageId } : {}),
            updatedAt: new Date(v.updatedAt),
            syncedAt: new Date(),
          },
          update: {
            slug: v.slug,
            duration: v.duration,
            lengthInMilliseconds: v.lengthInMilliseconds
              ? BigInt(v.lengthInMilliseconds)
              : null,
            hls: v.hls,
            dash: v.dash,
            share: v.share,
            downloadable: v.downloadable,
            published: v.published,
            ...(languageId ? { languageId } : {}),
            updatedAt: new Date(v.updatedAt),
            syncedAt: new Date(),
            deletedAt: null, // Revival
          },
        })
        stats.updated++
      } catch {
        stats.errors++
      }
      progress.increment()
    }

    if (variants.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return stats
}
