// Sync phase: videos
// The largest phase — syncs Video + VideoLocale rows.
// Depends on: languages (for primaryLanguageId FK)
//
// source='manager' rows are NEVER overwritten (short-circuit on upsert).

import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreBibleBookSchema, CoreVideoSchema } from "../schemas/video"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import { toPgArray } from "@/db/pgvector"
import { mapVideoLabel, mapVideoSource, toNameMap } from "../transforms"
import { syncVideoLocalizedMetadata } from "../video-localized-metadata"
import { withPrismaPoolTimeoutRetry } from "../pool-timeout-retry"

const BIBLE_BOOKS_QUERY = `
  query BibleBooks {
    bibleBooks {
      id
      osisId
      alternateName
      paratextAbbreviation
      isNewTestament
      order
      name { value primary language { id bcp47 } }
    }
  }
`

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
      publishedAt
      primaryLanguageId
      source
      origin { id }
      title(primary: false) { value primary language { id bcp47 } }
      description(primary: false) { value primary language { id bcp47 } }
      snippet(primary: false) { value primary language { id bcp47 } }
      studyQuestions(primary: false) {
        id
        value
        primary
        order
        language { id bcp47 }
      }
      imageAlt(primary: false) { value primary language { id bcp47 } }
      bibleCitations {
        id
        osisId
        chapterStart
        chapterEnd
        verseStart
        verseEnd
        order
        bibleBook { id osisId }
      }
      keywords { id }
      children { id }
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
  publishedAt: string | null
  primaryLanguageId: string | null
  source: string | null
  origin: { id: string } | null
  title: Array<{
    value: string
    primary?: boolean | null
    language: { bcp47?: string | null; id?: string }
  }>
  description: Array<{
    value: string
    primary?: boolean | null
    language: { bcp47?: string | null; id?: string }
  }>
  snippet: Array<{
    value: string
    primary?: boolean | null
    language: { bcp47?: string | null; id?: string }
  }>
  studyQuestions: Array<{
    id: string
    value: string
    primary?: boolean | null
    order?: number | null
    language: { id?: string; bcp47?: string | null }
  }>
  imageAlt: Array<{
    value: string
    primary?: boolean | null
    language: { bcp47?: string | null; id?: string }
  }>
  bibleCitations: Array<{
    id: string
    osisId: string | null
    chapterStart: number | null
    chapterEnd: number | null
    verseStart: number | null
    verseEnd: number | null
    order: number | null
    bibleBook: { id: string; osisId: string | null }
  }>
  keywords: Array<{ id: string }>
  children: Array<{ id: string }>
  locked: boolean
  noIndex: boolean
  updatedAt: string
}

type CoreBibleBook = {
  id: string
  osisId: string | null
  alternateName: string | null
  paratextAbbreviation: string | null
  isNewTestament: boolean | null
  order: number | null
  name: Array<{ value: string; language: { bcp47?: string; id?: string } }>
}

function encodeJsonForPgArray(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64")
}

async function bulkUpsertBibleBooks(
  prisma: PrismaClient,
  books: ReadonlyArray<{
    id: string
    coreId: string
    nameBase64: string
    osisId: string | null
    alternateName: string | null
    paratextAbbreviation: string | null
    isNewTestament: boolean | null
    testament: string | null
    order: number | null
  }>,
) {
  if (books.length === 0) return

  await prisma.$executeRaw`
    INSERT INTO "bible_book" (
      "id",
      "core_id",
      "source",
      "name",
      "osis_id",
      "alternate_name",
      "paratext_abbreviation",
      "is_new_testament",
      "testament",
      "order",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      convert_from(decode(input."name_base64", 'base64'), 'UTF8')::jsonb,
      input."osis_id",
      input."alternate_name",
      input."paratext_abbreviation",
      input."is_new_testament_text"::boolean,
      input."testament",
      input."order_text"::int,
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(books.map((book) => book.id))}::text[],
      ${toPgArray(books.map((book) => book.coreId))}::text[],
      ${toPgArray(books.map((book) => book.nameBase64))}::text[],
      ${toPgArray(books.map((book) => book.osisId))}::text[],
      ${toPgArray(books.map((book) => book.alternateName))}::text[],
      ${toPgArray(books.map((book) => book.paratextAbbreviation))}::text[],
      ${toPgArray(books.map((book) => (book.isNewTestament == null ? null : String(book.isNewTestament))))}::text[],
      ${toPgArray(books.map((book) => book.testament))}::text[],
      ${toPgArray(books.map((book) => book.order?.toString() ?? null))}::text[]
    ) AS input(
      "id",
      "core_id",
      "name_base64",
      "osis_id",
      "alternate_name",
      "paratext_abbreviation",
      "is_new_testament_text",
      "testament",
      "order_text"
    )
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "name"                  = EXCLUDED."name",
      "osis_id"               = EXCLUDED."osis_id",
      "alternate_name"        = EXCLUDED."alternate_name",
      "paratext_abbreviation" = EXCLUDED."paratext_abbreviation",
      "is_new_testament"      = EXCLUDED."is_new_testament",
      "testament"             = EXCLUDED."testament",
      "order"                 = EXCLUDED."order",
      "synced_at"             = EXCLUDED."synced_at",
      "updated_at"            = EXCLUDED."updated_at",
      "deleted_at"            = NULL
  `
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
    select: { id: true, coreId: true, bcp47: true, slug: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))
  const bcp47ByCoreId = new Map(languages.map((l) => [l.coreId, l.bcp47]))
  const slugByCoreId = new Map(languages.map((l) => [l.coreId, l.slug]))
  const origins = await prisma.videoOrigin.findMany({
    select: { id: true, coreId: true },
  })
  const originMap = new Map(origins.map((origin) => [origin.coreId, origin.id]))

  if (!since) {
    const bibleResult = await coreQuery<{ bibleBooks: CoreBibleBook[] }>(
      BIBLE_BOOKS_QUERY,
    )
    const rawBooks = bibleResult.data?.bibleBooks ?? []
    const parsedBooks = CoreBibleBookSchema.array().safeParse(rawBooks)
    if (!parsedBooks.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.bible-book.parse-error",
          issues: parsedBooks.error.issues,
        }),
      )
    } else if (parsedBooks.data.length > 0) {
      await withPrismaPoolTimeoutRetry(
        () =>
          bulkUpsertBibleBooks(
            prisma,
            parsedBooks.data.map((book) => ({
              id: randomUUID(),
              coreId: book.id,
              nameBase64: encodeJsonForPgArray(
                toNameMap(book.name, { bcp47ByCoreId }),
              ),
              osisId: book.osisId,
              alternateName: book.alternateName,
              paratextAbbreviation: book.paratextAbbreviation,
              isNewTestament: book.isNewTestament,
              testament:
                book.isNewTestament == null
                  ? null
                  : book.isNewTestament
                    ? "NT"
                    : "OT",
              order: book.order,
            })),
          ),
        { operation: "core-sync.videos.bible-books" },
      )
    }
  }

  const keywords = await prisma.keyword.findMany({
    select: { id: true, coreId: true },
  })
  const keywordMap = new Map(keywords.map((k) => [k.coreId, k.id]))
  const bibleBooks = await prisma.bibleBook.findMany({
    select: { id: true, coreId: true },
  })
  const bibleBookMap = new Map(bibleBooks.map((b) => [b.coreId, b.id]))

  const PAGE_SIZE = 25
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
      const pageResult = await withPrismaPoolTimeoutRetry(
        async () => {
          let pageUpdated = 0
          let pageErrors = 0
          await prisma.$transaction(async (tx) => {
            const pageCoreIds = videos.map((video) => video.id)
            const existingVideos = await tx.video.findMany({
              where: { coreId: { in: pageCoreIds } },
              select: { coreId: true, source: true },
            })
            const existingSourceByCoreId = new Map(
              existingVideos.map((video) => [video.coreId, video.source]),
            )
            const touchedVideoIds: string[] = []
            const videoKeywordRows: Array<{
              videoId: string
              keywordId: string
            }> = []
            const pendingRelations: Array<{
              parentId: string
              childCoreId: string
              order: number
            }> = []

            for (const video of videos) {
              const primaryLanguageId = video.primaryLanguageId
                ? (langMap.get(video.primaryLanguageId) ?? null)
                : null
              const originId = video.origin
                ? (originMap.get(video.origin.id) ?? null)
                : null

              if (existingSourceByCoreId.get(video.id) === "MANAGER") {
                continue
              }

              const videoRow = await tx.video.upsert({
                where: { coreId: video.id },
                create: {
                  coreId: video.id,
                  slug: video.slug,
                  label: mapVideoLabel(video.label),
                  videoSource: mapVideoSource(video.source),
                  publishedAt: video.publishedAt
                    ? new Date(video.publishedAt)
                    : null,
                  locked: video.locked,
                  noIndex: video.noIndex,
                  aiMetadata: false,
                  source: "CORE",
                  primaryLanguageId,
                  originId,
                  updatedAt: new Date(video.updatedAt),
                  syncedAt: new Date(),
                },
                update: {
                  slug: video.slug,
                  label: mapVideoLabel(video.label),
                  videoSource: mapVideoSource(video.source),
                  publishedAt: video.publishedAt
                    ? new Date(video.publishedAt)
                    : null,
                  locked: video.locked,
                  noIndex: video.noIndex,
                  primaryLanguageId,
                  originId,
                  updatedAt: new Date(video.updatedAt),
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
              touchedVideoIds.push(videoRow.id)

              const localizedResult = await syncVideoLocalizedMetadata({
                prisma: tx,
                adminVideos: [
                  {
                    id: videoRow.id,
                    coreId: video.id,
                    source: "CORE",
                    publishedAt: video.publishedAt,
                  },
                ],
                coreVideos: [video],
                languageIdByCoreId: langMap,
                bcp47ByCoreId,
                slugByCoreId,
              })
              pageErrors +=
                localizedResult.errors + localizedResult.skippedLanguages
              if (localizedResult.skippedLanguages > 0) {
                console.warn(
                  JSON.stringify({
                    event:
                      "core-sync.video-localized-metadata.skipped-languages",
                    videoCoreId: video.id,
                    skippedLanguages: localizedResult.skippedLanguages,
                    diagnostics: localizedResult.diagnostics,
                  }),
                )
              }

              const seenCitationIds = new Set(
                video.bibleCitations.map((citation) => citation.id),
              )
              for (const citation of video.bibleCitations) {
                const bibleBookId = bibleBookMap.get(citation.bibleBook.id)
                if (!bibleBookId) {
                  pageErrors++
                  console.warn(
                    JSON.stringify({
                      event: "core-sync.video-citation.missing-bible-book",
                      videoCoreId: video.id,
                      citationCoreId: citation.id,
                      bibleBookCoreId: citation.bibleBook.id,
                    }),
                  )
                  continue
                }
                await tx.bibleCitation.upsert({
                  where: { coreId: citation.id },
                  create: {
                    coreId: citation.id,
                    videoId: videoRow.id,
                    bibleBookId,
                    osisId: citation.osisId,
                    order: citation.order,
                    chapterStart: citation.chapterStart,
                    chapterEnd: citation.chapterEnd,
                    verseStart: citation.verseStart,
                    verseEnd: citation.verseEnd,
                    syncedAt: new Date(),
                  },
                  update: {
                    videoId: videoRow.id,
                    bibleBookId,
                    osisId: citation.osisId,
                    order: citation.order,
                    chapterStart: citation.chapterStart,
                    chapterEnd: citation.chapterEnd,
                    verseStart: citation.verseStart,
                    verseEnd: citation.verseEnd,
                    syncedAt: new Date(),
                    deletedAt: null,
                  },
                })
              }
              await tx.bibleCitation.updateMany({
                where: {
                  videoId: videoRow.id,
                  source: "CORE",
                  coreId: { notIn: [...seenCitationIds] },
                  deletedAt: null,
                },
                data: { deletedAt: new Date() },
              })

              for (const keyword of video.keywords) {
                const keywordId = keywordMap.get(keyword.id)
                if (!keywordId) continue
                videoKeywordRows.push({ videoId: videoRow.id, keywordId })
              }

              for (const [index, child] of video.children.entries()) {
                pendingRelations.push({
                  parentId: videoRow.id,
                  childCoreId: child.id,
                  order: index + 1,
                })
              }

              pageUpdated++
            }

            if (touchedVideoIds.length > 0) {
              await tx.videoKeyword.deleteMany({
                where: { videoId: { in: touchedVideoIds } },
              })
              if (videoKeywordRows.length > 0) {
                await tx.$executeRaw`
                  INSERT INTO "video_keyword" (
                    "video_id",
                    "keyword_id",
                    "created_at"
                  )
                  SELECT
                    input."video_id",
                    input."keyword_id",
                    NOW()
                  FROM unnest(
                    ${toPgArray(videoKeywordRows.map((row) => row.videoId))}::text[],
                    ${toPgArray(videoKeywordRows.map((row) => row.keywordId))}::text[]
                  ) AS input("video_id", "keyword_id")
                  ON CONFLICT ("video_id", "keyword_id") DO NOTHING
                `
              }

              await tx.videoRelation.deleteMany({
                where: { parentId: { in: touchedVideoIds } },
              })

              const childCoreIds = [
                ...new Set(
                  pendingRelations.map((relation) => relation.childCoreId),
                ),
              ]
              const childVideos =
                childCoreIds.length > 0
                  ? await tx.video.findMany({
                      where: { coreId: { in: childCoreIds } },
                      select: { id: true, coreId: true },
                    })
                  : []
              const childIdByCoreId = new Map(
                childVideos.map((child) => [child.coreId, child.id]),
              )
              const videoRelationRows = pendingRelations.flatMap((relation) => {
                const childId = childIdByCoreId.get(relation.childCoreId)
                return childId
                  ? [
                      {
                        id: randomUUID(),
                        parentId: relation.parentId,
                        childId,
                        order: relation.order,
                      },
                    ]
                  : []
              })

              if (videoRelationRows.length > 0) {
                await tx.$executeRaw`
                  INSERT INTO "video_relation" (
                    "id",
                    "parent_id",
                    "child_id",
                    "order",
                    "created_at"
                  )
                  SELECT
                    input."id",
                    input."parent_id",
                    input."child_id",
                    input."order_text"::int,
                    NOW()
                  FROM unnest(
                    ${toPgArray(videoRelationRows.map((row) => row.id))}::text[],
                    ${toPgArray(videoRelationRows.map((row) => row.parentId))}::text[],
                    ${toPgArray(videoRelationRows.map((row) => row.childId))}::text[],
                    ${toPgArray(videoRelationRows.map((row) => row.order.toString()))}::text[]
                  ) AS input("id", "parent_id", "child_id", "order_text")
                  ON CONFLICT ("parent_id", "child_id") DO NOTHING
                `
              }
            }
          }, CORE_SYNC_TRANSACTION_OPTIONS)

          return { errors: pageErrors, updated: pageUpdated }
        },
        { operation: `core-sync.videos.page.${offset}` },
      )
      stats.updated += pageResult.updated
      stats.errors += pageResult.errors
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
    try {
      const result = await withPrismaPoolTimeoutRetry(
        () =>
          prisma.video.updateMany({
            where: {
              source: "CORE",
              coreId: { notIn: [...seenCoreIds] },
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          }),
        { operation: "core-sync.videos.soft-delete" },
      )
      stats.softDeleted += result.count
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video.soft-delete.error",
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  return stats
}
