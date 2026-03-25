import type { Core } from "@strapi/strapi"
import type { ResultOf } from "@graphql-typed-document-node/core"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  docs,
  getPrimaryValue,
  formatError,
  findByCoreId,
  upsertByCoreId,
  softDeleteUnseen,
  buildCoreIdMap,
  clearableRelation,
} from "./strapi-helpers"
import { bulkUpsertByCoreId } from "./bulk-upsert"

const DEFAULT_PAGE_SIZE = 100

function getPageSize(): number {
  const env = process.env.CORE_SYNC_VIDEO_PAGE_SIZE
  const parsed = env ? Number(env) : DEFAULT_PAGE_SIZE
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE
}

const VIDEOS_COUNT_QUERY = graphql(/* GraphQL */ `
  query SyncVideosCount($where: VideosFilter) {
    videosCount(where: $where)
  }
`)

const BIBLE_BOOKS_QUERY = graphql(/* GraphQL */ `
  query SyncBibleBooks {
    bibleBooks {
      id
      osisId
      alternateName
      paratextAbbreviation
      isNewTestament
      order
      name(primary: true) {
        value
        primary
        language {
          id
        }
      }
    }
  }
`)

const VIDEOS_QUERY = graphql(/* GraphQL */ `
  query SyncVideos($limit: Int!, $offset: Int!, $where: VideosFilter) {
    videos(where: $where, limit: $limit, offset: $offset) {
      id
      slug
      label
      publishedAt
      primaryLanguageId
      locked
      noIndex
      source
      origin {
        id
        name
        description
      }
      title {
        id
        value
        primary
        language {
          id
        }
      }
      description {
        id
        value
        primary
        language {
          id
        }
      }
      snippet {
        id
        value
        primary
        language {
          id
        }
      }
      studyQuestions {
        id
        value
        primary
        order
        language {
          id
        }
      }
      imageAlt {
        id
        value
        primary
        language {
          id
        }
      }
      bibleCitations {
        id
        osisId
        chapterStart
        chapterEnd
        verseStart
        verseEnd
        order
        bibleBook {
          id
          osisId
        }
      }
      keywords {
        id
      }
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
        language {
          id
        }
        videoEdition {
          id
          name
        }
      }
      children {
        id
      }
    }
  }
`)

type CoreVideo = ResultOf<typeof VIDEOS_QUERY>["videos"][number]

/**
 * Sync a single video and its sub-entities (study questions, bible citations,
 * keywords, subtitles). Images are handled in bulk separately.
 */
async function syncSingleVideo(
  strapi: Core.Strapi,
  video: CoreVideo,
  caches: {
    originMap: Map<string, string>
    languageMap: Map<string, string>
    bibleBookMap: Map<string, string>
    keywordMap: Map<string, string>
    videoDocMap: Map<string, string>
  },
): Promise<{
  action: "created" | "updated" | "skipped"
  videoDocId: string | null
}> {
  const existing = await findByCoreId(
    strapi,
    "api::video.video",
    video.id,
    "en",
  )
  if (existing?.source === "manager")
    return { action: "skipped", videoDocId: existing.documentId }

  const primaryLangDocId = caches.languageMap.get(video.primaryLanguageId)

  const videoData = {
    title: getPrimaryValue(video.title),
    slug: video.slug,
    description: getPrimaryValue(video.description),
    snippet: getPrimaryValue(video.snippet),
    imageAlt: getPrimaryValue(video.imageAlt),
    label: video.label,
    videoSource: video.source ?? undefined,
    locked: video.locked,
    noIndex: video.noIndex ?? false,
    origin: video.origin
      ? clearableRelation(caches.originMap.get(video.origin.id))
      : { set: [] },
    primaryLanguage: clearableRelation(primaryLangDocId),
  }

  const { documentId: videoDocId, action } = await upsertByCoreId(
    strapi,
    "api::video.video",
    video.id,
    videoData,
    { locale: "en" },
  )

  // Store for later use
  caches.videoDocMap.set(video.id, videoDocId)

  // Upsert study questions
  for (const sq of video.studyQuestions) {
    if (!sq.id) continue
    try {
      await upsertByCoreId(
        strapi,
        "api::video-study-question.video-study-question",
        sq.id,
        {
          value: sq.value,
          order: sq.order,
          video: { connect: [videoDocId] },
        },
        { locale: "en" },
      )
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to upsert study question ${sq.id}: ${formatError(error)}`,
      )
    }
  }

  // Upsert bible citations
  for (const bc of video.bibleCitations) {
    try {
      const bookDocId = caches.bibleBookMap.get(bc.bibleBook.id)
      await upsertByCoreId(
        strapi,
        "api::bible-citation.bible-citation",
        bc.id,
        {
          osisId: bc.osisId,
          chapterStart: bc.chapterStart,
          chapterEnd: bc.chapterEnd ?? undefined,
          verseStart: bc.verseStart ?? undefined,
          verseEnd: bc.verseEnd ?? undefined,
          order: bc.order,
          bibleBook: clearableRelation(bookDocId),
          video: { connect: [videoDocId] },
        },
      )
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to upsert bible citation ${bc.id}: ${formatError(error)}`,
      )
    }
  }

  // Link keywords
  const keywordDocIds = video.keywords
    .map((kw) => caches.keywordMap.get(kw.id))
    .filter((id): id is string => id != null)
    .map((documentId) => ({ documentId }))

  if (keywordDocIds.length > 0) {
    try {
      await docs(strapi, "api::video.video").update({
        documentId: videoDocId,
        data: { keywords: keywordDocIds },
        locale: "en",
        status: "published",
      })
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to link keywords to video ${video.id}: ${formatError(error)}`,
      )
    }
  }

  // Pre-pass: upsert subtitle editions
  const editionMap = new Map<string, string>()
  for (const subtitle of video.subtitles) {
    if (subtitle.videoEdition && !editionMap.has(subtitle.videoEdition.id)) {
      try {
        const { documentId } = await upsertByCoreId(
          strapi,
          "api::video-edition.video-edition",
          subtitle.videoEdition.id,
          { name: subtitle.videoEdition.name ?? undefined },
        )
        editionMap.set(subtitle.videoEdition.id, documentId)
      } catch (error) {
        strapi.log.warn(
          `[core-sync] Failed to upsert edition ${subtitle.videoEdition.id}: ${formatError(error)}`,
        )
      }
    }
  }

  // Upsert subtitles
  for (const subtitle of video.subtitles) {
    try {
      const langDocId = caches.languageMap.get(subtitle.language.id)
      const editionDocId = subtitle.videoEdition
        ? editionMap.get(subtitle.videoEdition.id)
        : undefined

      await upsertByCoreId(
        strapi,
        "api::video-subtitle.video-subtitle",
        subtitle.id,
        {
          primary: subtitle.primary,
          vttSrc: subtitle.vttSrc ?? undefined,
          srtSrc: subtitle.srtSrc ?? undefined,
          value: subtitle.value,
          edition: subtitle.videoEdition?.name ?? undefined,
          language: clearableRelation(langDocId),
          videoEdition: clearableRelation(editionDocId),
          video: { connect: [videoDocId] },
        },
      )
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to upsert subtitle ${subtitle.id}: ${formatError(error)}`,
      )
    }
  }

  return { action, videoDocId }
}

export async function syncVideos(
  strapi: Core.Strapi,
  progress: ProgressReporter,
  since?: string,
): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }
  const pageSize = getPageSize()
  const isIncremental = !!since

  const mode = isIncremental ? "incremental" : "full"
  strapi.log.info(`[core-sync] Starting video sync (${mode})`)

  const where: { published: true; updatedAt?: { gte: string } } = {
    published: true,
  }
  if (since) where.updatedAt = { gte: since }

  let coreTotal = 0
  try {
    const { data: countData } = await getCoreClient().query({
      query: VIDEOS_COUNT_QUERY,
      variables: { where },
    })
    coreTotal = countData.videosCount
    if (coreTotal > 0) progress.setTotal(coreTotal)
    strapi.log.info(
      `[core-sync] Core API reports ${coreTotal} ${isIncremental ? "updated " : ""}published videos`,
    )
  } catch (error) {
    strapi.log.warn(
      `[core-sync] Failed to fetch video count: ${formatError(error)}`,
    )
  }

  // Sync BibleBooks (only on full sync)
  if (!isIncremental) {
    try {
      const bibleData = (
        await getCoreClient().query({ query: BIBLE_BOOKS_QUERY })
      ).data
      strapi.log.info(
        `[core-sync] Fetched ${bibleData.bibleBooks.length} bible books from core`,
      )
      for (const book of bibleData.bibleBooks) {
        await upsertByCoreId(
          strapi,
          "api::bible-book.bible-book",
          book.id,
          {
            name: getPrimaryValue(book.name),
            osisId: book.osisId,
            alternateName: book.alternateName ?? undefined,
            paratextAbbreviation: book.paratextAbbreviation,
            isNewTestament: book.isNewTestament,
            order: book.order,
          },
          { locale: "en" },
        )
      }
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to sync bible books: ${formatError(error)}`,
      )
    }
  }

  // Pre-load lookup caches
  const languageMap = await buildCoreIdMap(
    strapi,
    "api::language.language",
    "en",
  )
  const bibleBookMap = await buildCoreIdMap(
    strapi,
    "api::bible-book.bible-book",
    "en",
  )
  const keywordMap = await buildCoreIdMap(strapi, "api::keyword.keyword")
  const originMap = new Map<string, string>()
  const videoDocMap = new Map<string, string>()

  strapi.log.info(
    `[core-sync] Loaded caches: ${languageMap.size} languages, ${bibleBookMap.size} bible books, ${keywordMap.size} keywords`,
  )

  const seenVideoIds = new Set<string>()
  const seenSubtitleIds = new Set<string>()
  const seenImageIds = new Set<string>()
  const parentChildMap = new Map<string, string[]>()
  let offset = 0
  let totalProcessed = 0

  // Collect all images across pages for bulk upsert at the end
  const allImageRecords: Array<{
    coreId: string
    data: Record<string, unknown>
    links: Record<string, string | undefined>
  }> = []

  while (true) {
    let videos: CoreVideo[]
    try {
      const { data } = await getCoreClient().query({
        query: VIDEOS_QUERY,
        variables: { limit: pageSize, offset, where },
      })
      videos = data.videos
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to fetch video page (offset ${offset}): ${formatError(error)}. Stopping pagination.`,
      )
      break
    }

    if (videos.length === 0 && offset === 0 && !isIncremental) {
      strapi.log.error(
        "[core-sync] Core API returned 0 videos on first page — circuit breaker: skipping sync",
      )
      return stats
    }

    if (videos.length === 0) break

    // Pre-pass: upsert VideoOrigins
    for (const video of videos) {
      if (video.origin && !originMap.has(video.origin.id)) {
        try {
          const { documentId } = await upsertByCoreId(
            strapi,
            "api::video-origin.video-origin",
            video.origin.id,
            {
              name: video.origin.name,
              description: video.origin.description ?? undefined,
            },
          )
          originMap.set(video.origin.id, documentId)
        } catch (error) {
          strapi.log.warn(
            `[core-sync] Failed to upsert video origin ${video.origin.id}: ${formatError(error)}`,
          )
        }
      }
    }

    for (const video of videos) {
      seenVideoIds.add(video.id)
      for (const s of video.subtitles) seenSubtitleIds.add(s.id)
      for (const img of video.images) seenImageIds.add(img.id)

      const childIds = video.children.map((c) => c.id)
      if (childIds.length > 0) parentChildMap.set(video.id, childIds)

      try {
        const { action } = await syncSingleVideo(strapi, video, {
          originMap,
          languageMap,
          bibleBookMap,
          keywordMap,
          videoDocMap,
        })
        if (action === "created") stats.created++
        else if (action === "updated") stats.updated++

        // Collect image records for bulk upsert (after we know videoDocId)
        const videoDocId = videoDocMap.get(video.id)
        if (videoDocId) {
          for (const img of video.images) {
            allImageRecords.push({
              coreId: img.id,
              data: {
                cloudflare_id: img.id,
                aspect_ratio: img.aspectRatio ?? null,
                url: img.url ?? null,
                mobile_cinematic_high: img.mobileCinematicHigh ?? null,
                mobile_cinematic_low: img.mobileCinematicLow ?? null,
                mobile_cinematic_very_low: img.mobileCinematicVeryLow ?? null,
                thumbnail: img.thumbnail ?? null,
                video_still: img.videoStill ?? null,
                blurhash: img.blurhash ?? null,
              },
              links: {
                video_images_video_lnk: videoDocId,
              },
            })
          }
        }
      } catch (error) {
        stats.errors++
        strapi.log.warn(
          `[core-sync] Failed to sync video ${video.id}: ${formatError(error)}`,
        )
      }
    }

    totalProcessed += videos.length
    progress.increment(videos.length)
    const pct = coreTotal
      ? `${((totalProcessed / coreTotal) * 100).toFixed(1)}%`
      : "?"
    strapi.log.info(
      `[core-sync] Videos: ${totalProcessed}/${coreTotal} (${pct}) processed so far`,
    )

    if (videos.length < pageSize) break
    offset += pageSize
  }

  // Bulk upsert all images
  if (allImageRecords.length > 0) {
    strapi.log.info(
      `[core-sync] Bulk upserting ${allImageRecords.length} video images`,
    )
    const imageStats = await bulkUpsertByCoreId(
      strapi,
      {
        tableName: "video_images",
        locale: "",
        linkConfigs: [
          {
            linkTable: "video_images_video_lnk",
            sourceColumn: "video_image_id",
            targetTable: "videos",
            targetColumn: "video_id",
            targetLocale: "en",
            orderColumn: "video_image_ord",
          },
        ],
      },
      allImageRecords,
    )
    strapi.log.info(
      `[core-sync] Video images: ${imageStats.created} created, ${imageStats.updated} updated, ${imageStats.errors} errors`,
    )
  }

  // Soft-delete pass (full sync only)
  if (totalProcessed > 0 && !isIncremental) {
    stats.softDeleted += await softDeleteUnseen(
      strapi,
      "api::video.video",
      seenVideoIds,
      "en",
    )
    stats.softDeleted += await softDeleteUnseen(
      strapi,
      "api::video-subtitle.video-subtitle",
      seenSubtitleIds,
    )
    stats.softDeleted += await softDeleteUnseen(
      strapi,
      "api::video-image.video-image",
      seenImageIds,
    )
  }

  // Post-pass: link parent→children relations
  if (parentChildMap.size > 0) {
    const fullVideoMap = await buildCoreIdMap(strapi, "api::video.video", "en")
    let linked = 0

    for (const [parentCoreId, childCoreIds] of parentChildMap) {
      const parentDocId = fullVideoMap.get(parentCoreId)
      if (!parentDocId) continue

      const parentDoc = await findByCoreId(
        strapi,
        "api::video.video",
        parentCoreId,
        "en",
      )
      if (parentDoc?.source === "manager") continue

      const childDocIds = childCoreIds
        .map((id) => fullVideoMap.get(id))
        .filter((id): id is string => id != null)

      if (childDocIds.length === 0) continue

      try {
        await docs(strapi, "api::video.video").update({
          documentId: parentDocId,
          locale: "en",
          data: { children: { set: childDocIds } },
        })
        linked += childDocIds.length
      } catch (error) {
        strapi.log.warn(
          `[core-sync] Failed to link children to parent ${parentCoreId}: ${formatError(error)}`,
        )
      }
    }

    strapi.log.info(
      `[core-sync] Linked ${linked} child video relations across ${parentChildMap.size} parents`,
    )
  }

  const totalSynced = stats.created + stats.updated
  const successRate = coreTotal
    ? `${((totalSynced / coreTotal) * 100).toFixed(1)}%`
    : "N/A"

  strapi.log.info(
    `[core-sync] Video sync complete (${mode}): ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors (${totalSynced}/${coreTotal} = ${successRate})`,
  )

  return stats
}
