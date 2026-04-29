// Sync phase: video-dubs (formerly video-variants in Core)
//
// Boundary translation: Core's `videoVariant` → admin's `VideoDub`.
// The varying axis is the audio language (a dub), not the frames.
// Depends on: videos, languages

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreDubSchema } from "../schemas/dub"
import { emptySyncStats } from "../types"

const DUBS_QUERY = `
  query VideoVariants($offset: Int!, $limit: Int!, $input: VideoVariantFilter) {
    videoVariants(
      offset: $offset
      limit: $limit
      input: $input
    ) {
      id
      videoId
      slug
      duration
      lengthInMilliseconds
      hls
      dash
      share
      downloadable
      published
      brightcoveId
      updatedAt
      language { id }
      videoEdition { id name }
      muxVideo { id assetId playbackId }
      downloads {
        id
        quality
        size
        height
        width
        bitrate
        url
      }
    }
  }
`

const DUBS_BY_VIDEOS_QUERY = `
  query VideoDubsByVideos($offset: Int!, $limit: Int!, $where: VideosFilter) {
    videos(offset: $offset, limit: $limit, where: $where) {
      id
      variants {
        id
        videoId
        slug
        duration
        lengthInMilliseconds
        hls
        dash
        share
        downloadable
        published
        brightcoveId
        updatedAt
        language { id }
        videoEdition { id name }
        muxVideo { id assetId playbackId }
        downloads {
          id
          quality
          size
          height
          width
          bitrate
          url
        }
      }
    }
  }
`

type CoreVariant = {
  id: string
  videoId: string
  slug: string | null
  language: { id: string } | null
  duration: number
  lengthInMilliseconds: string | number | null
  hls: string | null
  dash: string | null
  share: string | null
  downloadable: boolean
  published: boolean
  brightcoveId: string | null
  videoEdition: { id: string; name: string | null } | null
  muxVideo: {
    id: string
    assetId: string | null
    playbackId: string | null
  } | null
  downloads: Array<{
    id: string
    quality: string | null
    size: string | number | null
    height: number | null
    width: number | null
    bitrate: number | null
    url: string | null
  }>
  updatedAt?: string
}

type CoreVideoWithVariants = {
  id: string
  variants: CoreVariant[]
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

  const videos = await prisma.video.findMany({
    select: { id: true, coreId: true },
  })
  const videoMap = new Map(videos.map((v) => [v.coreId, v.id]))

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const PAGE_SIZE = 500
  const VIDEO_BATCH_SIZE = 25
  let offset = 0
  let firstPageCount = 0
  const seenCoreIds = new Set<string>()

  async function processVariantPage(
    rawVariants: CoreVariant[],
    pageOffset: number,
  ) {
    const parsedVariants = CoreDubSchema.array().safeParse(rawVariants)
    if (!parsedVariants.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.parse-error",
          offset: pageOffset,
          issues: parsedVariants.error.issues,
        }),
      )
      progress.increment(rawVariants.length)
      return
    }

    const variants = parsedVariants.data
    if (variants.length === 0) return

    progress.setTotal(pageOffset + variants.length)

    try {
      let pageUpdated = 0
      let pageSkippedMissingVideo = 0
      const missingVideoSamples: Array<{ dubId: string; videoId: string }> = []
      await prisma.$transaction(
        async (tx) => {
          for (const variant of variants) {
            const videoId = videoMap.get(variant.videoId)
            if (!videoId) {
              pageSkippedMissingVideo++
              if (missingVideoSamples.length < 5) {
                missingVideoSamples.push({
                  dubId: variant.id,
                  videoId: variant.videoId,
                })
              }
              continue
            }

            if (!since) {
              seenCoreIds.add(variant.id)
            }

            const existingDub = await tx.videoDub.findUnique({
              where: { coreId: variant.id },
              select: { source: true },
            })
            if (existingDub?.source === "MANAGER") {
              continue
            }

            const languageId = variant.language
              ? (langMap.get(variant.language.id) ?? null)
              : null
            let videoEditionId: string | undefined
            if (variant.videoEdition) {
              const edition = await tx.videoEdition.upsert({
                where: { coreId: variant.videoEdition.id },
                create: {
                  coreId: variant.videoEdition.id,
                  name: variant.videoEdition.name ?? "",
                  syncedAt: new Date(),
                },
                update: {
                  name: variant.videoEdition.name ?? "",
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
              videoEditionId = edition.id
            }
            let muxVideoId: string | undefined
            if (variant.muxVideo) {
              const muxVideo = await tx.muxVideo.upsert({
                where: { coreId: variant.muxVideo.id },
                create: {
                  coreId: variant.muxVideo.id,
                  assetId: variant.muxVideo.assetId,
                  playbackId: variant.muxVideo.playbackId,
                  syncedAt: new Date(),
                },
                update: {
                  assetId: variant.muxVideo.assetId,
                  playbackId: variant.muxVideo.playbackId,
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
              muxVideoId = muxVideo.id
            }

            const updatedAt = variant.updatedAt
              ? new Date(variant.updatedAt)
              : new Date()

            const dub = await tx.videoDub.upsert({
              where: { coreId: variant.id },
              create: {
                coreId: variant.id,
                videoId,
                slug: variant.slug,
                duration: variant.duration,
                lengthInMilliseconds: variant.lengthInMilliseconds
                  ? BigInt(variant.lengthInMilliseconds)
                  : null,
                hls: variant.hls,
                dash: variant.dash,
                share: variant.share,
                downloadable: variant.downloadable,
                published: variant.published,
                brightcoveId: variant.brightcoveId,
                source: "CORE",
                languageId,
                videoEditionId: videoEditionId ?? null,
                muxVideoId: muxVideoId ?? null,
                updatedAt,
                syncedAt: new Date(),
              },
              update: {
                slug: variant.slug,
                duration: variant.duration,
                lengthInMilliseconds: variant.lengthInMilliseconds
                  ? BigInt(variant.lengthInMilliseconds)
                  : null,
                hls: variant.hls,
                dash: variant.dash,
                share: variant.share,
                downloadable: variant.downloadable,
                published: variant.published,
                brightcoveId: variant.brightcoveId,
                languageId,
                videoEditionId: videoEditionId ?? null,
                muxVideoId: muxVideoId ?? null,
                updatedAt,
                syncedAt: new Date(),
                deletedAt: null,
              },
            })

            const seenDownloadIds = new Set(
              variant.downloads.map((download) => download.id),
            )
            for (const download of variant.downloads) {
              await tx.videoDubDownload.upsert({
                where: { coreId: download.id },
                create: {
                  coreId: download.id,
                  videoDubId: dub.id,
                  quality: download.quality,
                  url: download.url,
                  size: download.size == null ? null : BigInt(download.size),
                  width: download.width,
                  height: download.height,
                  bitrate: download.bitrate,
                  syncedAt: new Date(),
                },
                update: {
                  videoDubId: dub.id,
                  quality: download.quality,
                  url: download.url,
                  size: download.size == null ? null : BigInt(download.size),
                  width: download.width,
                  height: download.height,
                  bitrate: download.bitrate,
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
            }
            await tx.videoDubDownload.updateMany({
              where: {
                videoDubId: dub.id,
                source: "CORE",
                coreId: { notIn: [...seenDownloadIds] },
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            })
            pageUpdated++
          }
        },
        { timeout: 60_000, maxWait: 5_000 },
      )
      stats.updated += pageUpdated
      if (pageSkippedMissingVideo > 0) {
        console.warn(
          JSON.stringify({
            event: "core-sync.video-dub.skipped-missing-videos",
            offset: pageOffset,
            count: pageSkippedMissingVideo,
            samples: missingVideoSamples,
          }),
        )
      }
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.error",
          offset: pageOffset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(variants.length)
  }

  if (since) {
    while (true) {
      const result = await coreQuery<{ videoVariants: CoreVariant[] }>(
        DUBS_QUERY,
        {
          offset,
          limit: PAGE_SIZE,
          input: { updatedAt: { gte: since } },
        },
      )

      const rawVariants = result.data?.videoVariants ?? []
      if (offset === 0) {
        firstPageCount = rawVariants.length
      }

      if (rawVariants.length === 0) break

      await processVariantPage(rawVariants, offset)

      if (rawVariants.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
  } else {
    firstPageCount = videos.length
    for (let index = 0; index < videos.length; index += VIDEO_BATCH_SIZE) {
      const batch = videos.slice(index, index + VIDEO_BATCH_SIZE)
      const result = await coreQuery<{ videos: CoreVideoWithVariants[] }>(
        DUBS_BY_VIDEOS_QUERY,
        {
          offset: 0,
          limit: batch.length,
          where: { ids: batch.map((video) => video.coreId) },
        },
      )

      const rawVariants =
        result.data?.videos.flatMap((video) =>
          video.variants.map((variant) => ({
            ...variant,
            videoId: variant.videoId ?? video.id,
          })),
        ) ?? []

      await processVariantPage(rawVariants, index)
    }
  }

  if (!since && firstPageCount === 0) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-dub.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.videoDub.updateMany({
      where: {
        source: "CORE",
        coreId: { notIn: [...seenCoreIds] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })
    stats.softDeleted += result.count
  }

  return stats
}
