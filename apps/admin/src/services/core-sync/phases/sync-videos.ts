// Sync phase: videos
// The largest phase — syncs Video + VideoLocale rows.
// Depends on: languages (for primaryLanguageId FK)
//
// source='manager' rows are NEVER overwritten (short-circuit on upsert).

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreBibleBookSchema, CoreVideoSchema } from "../schemas/video"
import { emptySyncStats } from "../types"
import {
  mapVideoLabel,
  mapVideoSource,
  toNameMap,
  toStudyQuestions,
  toVideoLocales,
} from "../transforms"

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
      origin { id name description }
      title { value language { bcp47 } }
      description { value language { bcp47 } }
      snippet { value language { bcp47 } }
      studyQuestions {
        id
        value
        primary
        order
        language { id bcp47 }
      }
      imageAlt { value language { bcp47 } }
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
      images {
        id
        aspectRatio
        mobileCinematicHigh
        mobileCinematicLow
        mobileCinematicVeryLow
        thumbnail
        videoStill
        blurhash
        url
      }
      subtitles {
        id
        primary
        vttSrc
        srtSrc
        value
        language { id }
        videoEdition { id name }
      }
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
  origin: { id: string; name: string; description: string | null } | null
  title: Array<{
    value: string
    primary?: boolean | null
    language: { bcp47?: string; id?: string }
  }>
  description: Array<{
    value: string
    primary?: boolean | null
    language: { bcp47?: string; id?: string }
  }>
  snippet: Array<{
    value: string
    primary?: boolean | null
    language: { bcp47?: string; id?: string }
  }>
  studyQuestions: Array<{
    id: string
    value: string
    primary?: boolean | null
    order?: number | null
    language: { id?: string; bcp47?: string }
  }>
  imageAlt: Array<{
    value: string
    primary?: boolean | null
    language: { bcp47?: string; id?: string }
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
  images: Array<{
    id: string
    aspectRatio: string | null
    mobileCinematicHigh: string | null
    mobileCinematicLow: string | null
    mobileCinematicVeryLow: string | null
    thumbnail: string | null
    videoStill: string | null
    blurhash: string | null
    url: string | null
  }>
  subtitles: Array<{
    id: string
    primary: boolean | null
    vttSrc: string | null
    srtSrc: string | null
    value: string | null
    language: { id: string } | null
    videoEdition: { id: string; name: string | null } | null
  }>
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
    select: { id: true, coreId: true, bcp47: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))
  const bcp47ByCoreId = new Map(languages.map((l) => [l.coreId, l.bcp47]))

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
      await prisma.$transaction(async (tx) => {
        for (const book of parsedBooks.data) {
          await tx.bibleBook.upsert({
            where: { coreId: book.id },
            create: {
              coreId: book.id,
              name: toNameMap(book.name, { bcp47ByCoreId }),
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
              syncedAt: new Date(),
            },
            update: {
              name: toNameMap(book.name, { bcp47ByCoreId }),
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
              syncedAt: new Date(),
              deletedAt: null,
            },
          })
        }
      })
    }
  }

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
      let pageUpdated = 0
      await prisma.$transaction(
        async (tx) => {
          const keywords = await tx.keyword.findMany({
            select: { id: true, coreId: true },
          })
          const keywordMap = new Map(keywords.map((k) => [k.coreId, k.id]))
          const bibleBooks = await tx.bibleBook.findMany({
            select: { id: true, coreId: true },
          })
          const bibleBookMap = new Map(bibleBooks.map((b) => [b.coreId, b.id]))

          for (const video of videos) {
            const primaryLanguageId = video.primaryLanguageId
              ? (langMap.get(video.primaryLanguageId) ?? null)
              : null
            let originId: string | undefined
            if (video.origin) {
              const origin = await tx.videoOrigin.upsert({
                where: { coreId: video.origin.id },
                create: {
                  coreId: video.origin.id,
                  name: video.origin.name,
                  description: video.origin.description,
                  syncedAt: new Date(),
                },
                update: {
                  name: video.origin.name,
                  description: video.origin.description,
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
              originId = origin.id
            }

            const existing = await tx.video.findUnique({
              where: { coreId: video.id },
              select: { source: true },
            })
            if (existing?.source === "MANAGER") {
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
                originId: originId ?? null,
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
                originId: originId ?? null,
                updatedAt: new Date(video.updatedAt),
                syncedAt: new Date(),
                deletedAt: null,
              },
            })

            for (const localeRow of toVideoLocales(
              {
                title: video.title,
                description: video.description,
                snippet: video.snippet,
                imageAlt: video.imageAlt,
              },
              { bcp47ByCoreId },
            )) {
              await tx.videoLocale.upsert({
                where: {
                  videoId_locale: {
                    videoId: videoRow.id,
                    locale: localeRow.locale,
                  },
                },
                create: {
                  videoId: videoRow.id,
                  locale: localeRow.locale,
                  title: localeRow.title,
                  description: localeRow.description,
                  snippet: localeRow.snippet,
                  imageAlt: localeRow.imageAlt,
                  status: "PUBLISHED",
                  publishedAt: video.publishedAt
                    ? new Date(video.publishedAt)
                    : null,
                },
                update: {
                  title: localeRow.title,
                  description: localeRow.description,
                  snippet: localeRow.snippet,
                  imageAlt: localeRow.imageAlt,
                  publishedAt: video.publishedAt
                    ? new Date(video.publishedAt)
                    : null,
                },
              })
            }

            const seenImageIds = new Set(video.images.map((image) => image.id))
            for (const image of video.images) {
              await tx.videoImage.upsert({
                where: { coreId: image.id },
                create: {
                  coreId: image.id,
                  videoId: videoRow.id,
                  url: image.url,
                  aspectRatio: image.aspectRatio,
                  mobileCinematicHigh: image.mobileCinematicHigh,
                  mobileCinematicLow: image.mobileCinematicLow,
                  mobileCinematicVeryLow: image.mobileCinematicVeryLow,
                  thumbnail: image.thumbnail,
                  videoStill: image.videoStill,
                  blurhash: image.blurhash,
                  syncedAt: new Date(),
                },
                update: {
                  videoId: videoRow.id,
                  url: image.url,
                  aspectRatio: image.aspectRatio,
                  mobileCinematicHigh: image.mobileCinematicHigh,
                  mobileCinematicLow: image.mobileCinematicLow,
                  mobileCinematicVeryLow: image.mobileCinematicVeryLow,
                  thumbnail: image.thumbnail,
                  videoStill: image.videoStill,
                  blurhash: image.blurhash,
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
            }
            await tx.videoImage.updateMany({
              where: {
                videoId: videoRow.id,
                source: "CORE",
                coreId: { notIn: [...seenImageIds] },
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            })

            const seenStudyQuestionIds = new Set(
              video.studyQuestions.map((question) => question.id),
            )
            for (const question of toStudyQuestions(video.studyQuestions, {
              bcp47ByCoreId,
            })) {
              await tx.videoStudyQuestion.upsert({
                where: { coreId: question.coreId },
                create: {
                  coreId: question.coreId,
                  videoId: videoRow.id,
                  locale: question.locale,
                  languageId: question.languageCoreId
                    ? (langMap.get(question.languageCoreId) ?? null)
                    : null,
                  text: question.text,
                  primary: question.primary,
                  order: question.order,
                  syncedAt: new Date(),
                },
                update: {
                  videoId: videoRow.id,
                  locale: question.locale,
                  languageId: question.languageCoreId
                    ? (langMap.get(question.languageCoreId) ?? null)
                    : null,
                  text: question.text,
                  primary: question.primary,
                  order: question.order,
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
            }
            await tx.videoStudyQuestion.updateMany({
              where: {
                videoId: videoRow.id,
                source: "CORE",
                coreId: { notIn: [...seenStudyQuestionIds] },
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            })

            const seenCitationIds = new Set(
              video.bibleCitations.map((citation) => citation.id),
            )
            for (const citation of video.bibleCitations) {
              const bibleBookId = bibleBookMap.get(citation.bibleBook.id)
              if (!bibleBookId) {
                stats.errors++
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

            await tx.videoKeyword.deleteMany({
              where: { videoId: videoRow.id },
            })
            for (const keyword of video.keywords) {
              const keywordId = keywordMap.get(keyword.id)
              if (!keywordId) continue
              await tx.videoKeyword.create({
                data: { videoId: videoRow.id, keywordId },
              })
            }

            const seenSubtitleIds = new Set(
              video.subtitles.map((subtitle) => subtitle.id),
            )
            for (const subtitle of video.subtitles) {
              let videoEditionId: string | null = null
              if (subtitle.videoEdition) {
                const edition = await tx.videoEdition.upsert({
                  where: { coreId: subtitle.videoEdition.id },
                  create: {
                    coreId: subtitle.videoEdition.id,
                    name: subtitle.videoEdition.name ?? "",
                    syncedAt: new Date(),
                  },
                  update: {
                    name: subtitle.videoEdition.name ?? "",
                    syncedAt: new Date(),
                    deletedAt: null,
                  },
                })
                videoEditionId = edition.id
              }
              if (!videoEditionId) continue
              await tx.videoSubtitle.upsert({
                where: { coreId: subtitle.id },
                create: {
                  coreId: subtitle.id,
                  videoId: videoRow.id,
                  videoEditionId,
                  languageId: subtitle.language
                    ? (langMap.get(subtitle.language.id) ?? null)
                    : null,
                  value: subtitle.value,
                  primary: subtitle.primary ?? false,
                  vttSrc: subtitle.vttSrc,
                  srtSrc: subtitle.srtSrc,
                  syncedAt: new Date(),
                },
                update: {
                  videoId: videoRow.id,
                  videoEditionId,
                  languageId: subtitle.language
                    ? (langMap.get(subtitle.language.id) ?? null)
                    : null,
                  value: subtitle.value,
                  primary: subtitle.primary ?? false,
                  vttSrc: subtitle.vttSrc,
                  srtSrc: subtitle.srtSrc,
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
            }
            await tx.videoSubtitle.updateMany({
              where: {
                videoId: videoRow.id,
                source: "CORE",
                coreId: { notIn: [...seenSubtitleIds] },
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            })

            await tx.videoRelation.deleteMany({
              where: { parentId: videoRow.id },
            })
            for (const child of video.children) {
              const childVideo = await tx.video.findUnique({
                where: { coreId: child.id },
                select: { id: true },
              })
              if (!childVideo) continue
              await tx.videoRelation.create({
                data: { parentId: videoRow.id, childId: childVideo.id },
              })
            }

            pageUpdated++
          }
        },
        { timeout: 60_000, maxWait: 5_000 },
      )
      stats.updated += pageUpdated
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
