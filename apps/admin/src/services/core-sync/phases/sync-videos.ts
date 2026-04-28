// Sync phase: videos
// The largest phase — syncs Video + VideoLocale rows.
// Depends on: languages (for primaryLanguageId FK)
//
// source='manager' rows are NEVER overwritten. The protection lives
// in the ON CONFLICT WHERE clause — `WHERE "video"."source" != 'manager'`
// — so manager-authored rows pass right through the UPDATE branch
// untouched. RETURNING returns only the rows actually
// inserted-or-updated, which we then use to drive the per-locale
// VideoLocale upsert.
//
// Bulk INSERT … ON CONFLICT … per page; see bulk-upsert.ts header for
// the prod failure mode this replaces.

import { Prisma, type PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoSchema } from "../schemas/video"
import { emptySyncStats } from "../types"
import { newRowId } from "../bulk-upsert"

const VIDEOS_QUERY = `
  query Videos($offset: Int!, $limit: Int!, $where: VideosFilter) {
    videos(
      offset: $offset
      limit: $limit
      where: $where
    ) {
      id
      slug
      label
      primaryLanguageId
      title { value language { bcp47 } }
      description { value language { bcp47 } }
      snippet { value language { bcp47 } }
      imageAlt { value language { bcp47 } }
      locked
      noIndex
      updatedAt
    }
  }
`

type CoreVideo = {
  id: string
  slug: string
  label: string | null
  primaryLanguageId: string | null
  title: Array<{ value: string; language: { bcp47?: string } }>
  description: Array<{ value: string; language: { bcp47?: string } }>
  snippet: Array<{ value: string; language: { bcp47?: string } }>
  imageAlt: Array<{ value: string; language: { bcp47?: string } }>
  locked: boolean
  noIndex: boolean
  updatedAt: string
}

export async function syncVideos({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const PAGE_SIZE = 500
  let offset = 0
  let firstPageCount = 0
  const seenCoreIds = new Set<string>()

  while (true) {
    const result = await coreQuery<{ videos: CoreVideo[] }>(VIDEOS_QUERY, {
      offset,
      limit: PAGE_SIZE,
      where: {
        published: true,
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
    })

    const rawVideos = result.data?.videos ?? []
    if (offset === 0) {
      firstPageCount = rawVideos.length
    }

    const parsedVideos = CoreVideoSchema.array().safeParse(rawVideos)
    if (!parsedVideos.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video.parse-error",
          offset,
          issues: parsedVideos.error.issues,
        }),
      )
      progress.increment(rawVideos.length)
      if (rawVideos.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const videos = parsedVideos.data
    if (videos.length === 0) break

    if (!since) {
      for (const video of videos) {
        seenCoreIds.add(video.id)
      }
    }

    progress.setTotal(offset + videos.length)

    try {
      const now = new Date()

      // ---- Step 1: bulk-upsert Video rows. The ON CONFLICT WHERE
      // clause skips source='manager' rows — manager-authored content
      // is never overwritten by Core sync. RETURNING gives back the
      // (id, core_id) pairs of rows actually written, which drives the
      // per-locale VideoLocale upsert below. Manager-protected rows
      // are excluded from the result, so their VideoLocale rows are
      // also left untouched.
      const videoTuples = videos.map((video) => {
        const primaryLanguageId = video.primaryLanguageId
          ? (langMap.get(video.primaryLanguageId) ?? null)
          : null
        // Column order: id, core_id, slug, label, locked, no_index,
        // ai_metadata, primary_language_id, synced_at, updated_at
        return Prisma.sql`(${newRowId()}, ${video.id}, ${video.slug}, ${mapLabel(video.label)}::"VideoLabel", ${video.locked}, ${video.noIndex}, ${false}, ${primaryLanguageId}, ${now}, ${new Date(video.updatedAt)})`
      })

      const writtenVideos = await prisma.$queryRaw<
        Array<{ id: string; core_id: string }>
      >(
        Prisma.sql`
          INSERT INTO "video" (
            "id", "core_id", "slug", "label", "locked", "no_index",
            "ai_metadata", "primary_language_id", "synced_at", "updated_at"
          )
          VALUES ${Prisma.join(videoTuples, ", ")}
          ON CONFLICT ("core_id") DO UPDATE SET
            "slug"                = EXCLUDED."slug",
            "label"               = EXCLUDED."label",
            "locked"              = EXCLUDED."locked",
            "no_index"            = EXCLUDED."no_index",
            "primary_language_id" = EXCLUDED."primary_language_id",
            "synced_at"           = EXCLUDED."synced_at",
            "updated_at"          = EXCLUDED."updated_at",
            "deleted_at"          = NULL
          WHERE "video"."source" != 'manager'::"SourceTier"
          RETURNING "id", "core_id"
        `,
      )

      // Manager-protected rows are filtered out of the RETURNING set,
      // so the Map below only contains the videos we successfully
      // wrote. Any video whose coreId is missing from this map was
      // either skipped (manager-authored) or — unexpectedly — not
      // written; either way we skip its VideoLocale upsert.
      const coreIdToVideoId = new Map<string, string>()
      for (const row of writtenVideos) {
        coreIdToVideoId.set(row.core_id, row.id)
      }

      // ---- Step 2: bulk-upsert VideoLocale rows for the videos
      // actually written. Flatten one tuple per (videoId, locale)
      // across the whole page.
      const localeTuples: Prisma.Sql[] = []
      for (const video of videos) {
        const videoId = coreIdToVideoId.get(video.id)
        if (!videoId) continue // manager-protected; skip locales

        const locales = new Set<string>()
        for (const localizedValue of [
          ...video.title,
          ...video.description,
          ...video.snippet,
        ]) {
          if (localizedValue.language.bcp47) {
            locales.add(localizedValue.language.bcp47)
          }
        }

        for (const locale of locales) {
          const title =
            video.title.find((t) => t.language.bcp47 === locale)?.value ?? null
          const description =
            video.description.find((d) => d.language.bcp47 === locale)?.value ??
            null
          const snippet =
            video.snippet.find((s) => s.language.bcp47 === locale)?.value ??
            null
          const imageAlt =
            video.imageAlt.find((a) => a.language.bcp47 === locale)?.value ??
            null

          // Column order: id, video_id, locale, title, description,
          // snippet, image_alt, status, updated_at
          localeTuples.push(
            Prisma.sql`(${newRowId()}, ${videoId}, ${locale}, ${title}, ${description}, ${snippet}, ${imageAlt}, ${"published"}::"LocaleStatus", ${now})`,
          )
        }
      }

      if (localeTuples.length > 0) {
        await prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO "video_locale" (
              "id", "video_id", "locale", "title", "description",
              "snippet", "image_alt", "status", "updated_at"
            )
            VALUES ${Prisma.join(localeTuples, ", ")}
            ON CONFLICT ("video_id", "locale") DO UPDATE SET
              "title"       = EXCLUDED."title",
              "description" = EXCLUDED."description",
              "snippet"     = EXCLUDED."snippet",
              "image_alt"   = EXCLUDED."image_alt",
              "updated_at"  = EXCLUDED."updated_at"
          `,
        )
      }

      stats.updated += writtenVideos.length
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(videos.length)

    if (videos.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageCount === 0) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.video.updateMany({
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

function mapLabel(label: string | null): string | null {
  if (!label) return null
  // Map Core's camelCase label string to admin's UPPER_SNAKE enum value.
  // Returned as a plain string; the SQL caller adds the `::"VideoLabel"`
  // cast so Postgres coerces it into the enum on bind.
  const MAP: Record<string, string> = {
    collection: "collection",
    episode: "episode",
    featureFilm: "featureFilm",
    segment: "segment",
    series: "series",
    shortFilm: "shortFilm",
    trailer: "trailer",
    behindTheScenes: "behindTheScenes",
  }
  return MAP[label] ?? null
}
