// Sync phase: video-dubs (formerly video-variants in Core)
//
// Boundary translation: Core's `videoVariant` → admin's `VideoDub`.
// The varying axis is the audio language (a dub), not the frames.
// Depends on: videos, languages
//
// Bulk INSERT … ON CONFLICT DO UPDATE per page. The MANAGER protection
// lives in the ON CONFLICT WHERE clause — `WHERE "video_dub"."source"
// != 'manager'` — same pattern as sync-videos.ts. Variants whose
// videoId can't be resolved are filtered out client-side and counted
// as skipped (not errored).

import { Prisma, type PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreDubSchema } from "../schemas/dub"
import { emptySyncStats } from "../types"
import { bulkErrorLogFields, newRowId } from "../bulk-upsert"

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
      updatedAt
      language { id }
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
  let firstPageCount = 0
  const seenCoreIds = new Set<string>()

  while (true) {
    const result = await coreQuery<{ videoVariants: CoreVariant[] }>(
      DUBS_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        input: since ? { updatedAt: { gte: since } } : undefined,
      },
    )

    const rawVariants = result.data?.videoVariants ?? []
    if (offset === 0) {
      firstPageCount = rawVariants.length
    }

    const parsedVariants = CoreDubSchema.array().safeParse(rawVariants)
    if (!parsedVariants.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.parse-error",
          offset,
          issues: parsedVariants.error.issues,
        }),
      )
      progress.increment(rawVariants.length)
      if (rawVariants.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const variants = parsedVariants.data
    if (variants.length === 0) break

    if (!since) {
      for (const variant of variants) {
        seenCoreIds.add(variant.id)
      }
    }

    progress.setTotal(offset + variants.length)

    try {
      const now = new Date()

      // Filter out variants whose video FK can't be resolved. The
      // legacy code threw on this; we'd rather log and skip the
      // orphaned dub than poison the entire page (one stale FK
      // shouldn't strand the rest of a 500-row batch).
      const eligibleVariants: CoreVariant[] = []
      for (const variant of variants) {
        const videoId = videoMap.get(variant.videoId)
        if (!videoId) {
          stats.skipped++
          console.warn(
            JSON.stringify({
              event: "core-sync.video-dub.skipped",
              reason: "missing_video_fk",
              dubCoreId: variant.id,
              videoCoreId: variant.videoId,
            }),
          )
          continue
        }
        eligibleVariants.push(variant)
      }

      if (eligibleVariants.length > 0) {
        const dubTuples = eligibleVariants.map((variant) => {
          const videoId = videoMap.get(variant.videoId)!
          const languageId = variant.language
            ? (langMap.get(variant.language.id) ?? null)
            : null
          // Explicit null check — `0` is falsy and a legitimate
          // zero-length dub would otherwise round-trip as NULL. The
          // legacy upsert had the same truthiness bug; fixing here
          // since the new bulk path is the canonical writer going
          // forward.
          const lengthInMs =
            variant.lengthInMilliseconds == null
              ? null
              : BigInt(variant.lengthInMilliseconds)
          // Column order: id, core_id, slug, duration,
          // length_in_milliseconds, hls, dash, share, downloadable,
          // published, video_id, language_id, synced_at, updated_at
          return Prisma.sql`(${newRowId()}, ${variant.id}, ${variant.slug}, ${variant.duration}, ${lengthInMs}, ${variant.hls}, ${variant.dash}, ${variant.share}, ${variant.downloadable}, ${variant.published}, ${videoId}, ${languageId}, ${now}, ${new Date(variant.updatedAt)})`
        })

        const writtenDubs = await prisma.$queryRaw<
          Array<{ id: string; core_id: string }>
        >(
          Prisma.sql`
            INSERT INTO "video_dub" (
              "id", "core_id", "slug", "duration", "length_in_milliseconds",
              "hls", "dash", "share", "downloadable", "published",
              "video_id", "language_id", "synced_at", "updated_at"
            )
            VALUES ${Prisma.join(dubTuples, ", ")}
            ON CONFLICT ("core_id") DO UPDATE SET
              "slug"                   = EXCLUDED."slug",
              "duration"               = EXCLUDED."duration",
              "length_in_milliseconds" = EXCLUDED."length_in_milliseconds",
              "hls"                    = EXCLUDED."hls",
              "dash"                   = EXCLUDED."dash",
              "share"                  = EXCLUDED."share",
              "downloadable"           = EXCLUDED."downloadable",
              "published"              = EXCLUDED."published",
              "language_id"            = EXCLUDED."language_id",
              "synced_at"              = EXCLUDED."synced_at",
              "updated_at"             = EXCLUDED."updated_at",
              "deleted_at"             = NULL
            WHERE "video_dub"."source" != 'manager'::"SourceTier"
            RETURNING "id", "core_id"
          `,
        )
        stats.updated += writtenDubs.length
      }
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.error",
          offset,
          firstCoreId: variants[0]?.id,
          lastCoreId: variants[variants.length - 1]?.id,
          ...bulkErrorLogFields(err),
        }),
      )
    }

    progress.increment(variants.length)

    if (variants.length < PAGE_SIZE) break
    offset += PAGE_SIZE
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
