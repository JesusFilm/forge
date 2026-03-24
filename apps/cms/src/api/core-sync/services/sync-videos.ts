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

const DEFAULT_PAGE_SIZE = 100

function getPageSize(): number {
  const env = process.env.CORE_SYNC_VIDEO_PAGE_SIZE
  const parsed = env ? Number(env) : DEFAULT_PAGE_SIZE
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE
}

const VIDEOS_COUNT_QUERY = graphql(/* GraphQL */ `
  query SyncVideosCount {
    videosCount(where: { published: true })
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
  query SyncVideos($limit: Int!, $offset: Int!) {
    videos(where: { published: true }, limit: $limit, offset: $offset) {
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

async function syncSingleVideo(
  strapi: Core.Strapi,
  video: CoreVideo,
  caches: {
    originMap: Map<string, string>
    languageMap: Map<string, string>
    bibleBookMap: Map<string, string>
    keywordMap: Map<string, string>
  },
): Promise<"created" | "updated" | "skipped"> {
  // Check if this video is manager-owned (early exit to skip all sub-entity work)
  const existing = await findByCoreId(
    strapi,
    "api::video.video",
    video.id,
    "en",
  )
  if (existing?.source === "manager") return "skipped"

  // Resolve primary language from cache
  const primaryLangDocId = caches.languageMap.get(video.primaryLanguageId)

  // Build images (all aspect ratios)
  const images = video.images.map((img) => ({
    cloudflareId: img.id,
    aspectRatio: img.aspectRatio ?? undefined,
    url: img.url ?? undefined,
    mobileCinematicHigh: img.mobileCinematicHigh ?? undefined,
    mobileCinematicLow: img.mobileCinematicLow ?? undefined,
    mobileCinematicVeryLow: img.mobileCinematicVeryLow ?? undefined,
    thumbnail: img.thumbnail ?? undefined,
    videoStill: img.videoStill ?? undefined,
    blurhash: img.blurhash ?? undefined,
  }))

  // Create/update video WITHOUT keyword, studyQuestion, or bibleCitation relations first
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
    images,
  }

  const { documentId: videoDocId, action } = await upsertByCoreId(
    strapi,
    "api::video.video",
    video.id,
    videoData,
    { locale: "en" },
  )

  // Upsert study questions as separate entities with order
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
        `[core-sync] Failed to upsert study question ${sq.id} (video=${video.id}, videoDocId=${videoDocId}, action=${action}): ${formatError(error)}`,
      )
    }
  }

  // Upsert bible citations as separate collection type records
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

  // Link keywords (already synced in keywords phase) to this video
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
          `[core-sync] Failed to upsert edition ${subtitle.videoEdition.id}: ${error instanceof Error ? error.message : String(error)}`,
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

  return action === "created"
    ? "created"
    : action === "updated"
      ? "updated"
      : "skipped"
}

export async function syncVideos(
  strapi: Core.Strapi,
  progress: ProgressReporter,
): Promise<SyncStats> {
  const stats: SyncStats = { created: 0, updated: 0, softDeleted: 0, errors: 0 }
  const pageSize = getPageSize()

  strapi.log.info("[core-sync] Starting video sync")

  // Get total count from core for comparison
  let coreTotal = 0
  try {
    const { data: countData } = await getCoreClient().query({
      query: VIDEOS_COUNT_QUERY,
    })
    coreTotal = countData.videosCount
    if (coreTotal > 0) progress.setTotal(coreTotal)
    strapi.log.info(
      `[core-sync] Core API reports ${coreTotal} published videos`,
    )
  } catch (error) {
    strapi.log.warn(
      `[core-sync] Failed to fetch video count: ${formatError(error)}`,
    )
  }

  // First pass: sync all BibleBooks (needed before bible citations)
  try {
    const bibleData = (
      await getCoreClient().query({ query: BIBLE_BOOKS_QUERY })
    ).data
    strapi.log.info(
      `[core-sync] Fetched ${bibleData.bibleBooks.length} bible books from core`,
    )
    for (const book of bibleData.bibleBooks) {
      const primaryName = getPrimaryValue(book.name)
      await upsertByCoreId(
        strapi,
        "api::bible-book.bible-book",
        book.id,
        {
          name: primaryName,
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

  // Pre-load lookup caches to avoid N+1 queries in per-video loops
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
  const originMap = new Map<string, string>() // built incrementally from video pages

  strapi.log.info(
    `[core-sync] Loaded caches: ${languageMap.size} languages, ${bibleBookMap.size} bible books, ${keywordMap.size} keywords`,
  )

  const seenVideoIds = new Set<string>()
  const seenSubtitleIds = new Set<string>()
  // Track parent→children core IDs for the post-pass relation linking
  const parentChildMap = new Map<string, string[]>()
  let offset = 0
  let totalProcessed = 0

  while (true) {
    let videos: CoreVideo[]
    try {
      const { data } = await getCoreClient().query({
        query: VIDEOS_QUERY,
        variables: {
          limit: pageSize,
          offset,
        },
      })
      videos = data.videos
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to fetch video page (offset ${offset}): ${formatError(error)}. Stopping pagination.`,
      )
      break
    }

    // Circuit breaker: core returned 0 on first page
    if (videos.length === 0 && offset === 0) {
      strapi.log.error(
        "[core-sync] Core API returned 0 videos on first page — circuit breaker: skipping sync",
      )
      return stats
    }

    if (videos.length === 0) break

    // Pre-pass: upsert all VideoOrigins from this page (hoisted map persists across pages)
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

      // Record parent→children for the post-pass
      const childIds = video.children.map((c) => c.id)
      if (childIds.length > 0) {
        parentChildMap.set(video.id, childIds)
      }

      try {
        const result = await syncSingleVideo(strapi, video, {
          originMap,
          languageMap,
          bibleBookMap,
          keywordMap,
        })
        if (result === "created") stats.created++
        else if (result === "updated") stats.updated++
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

  // Soft-delete pass
  if (totalProcessed > 0) {
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
  }

  // Post-pass: link parent→children relations now that all videos exist
  if (parentChildMap.size > 0) {
    const videoMap = await buildCoreIdMap(strapi, "api::video.video", "en")
    let linked = 0

    for (const [parentCoreId, childCoreIds] of parentChildMap) {
      const parentDocId = videoMap.get(parentCoreId)
      if (!parentDocId) continue

      // Skip manager-owned parents — their children relations are managed by the manager app
      const parentDoc = await findByCoreId(
        strapi,
        "api::video.video",
        parentCoreId,
        "en",
      )
      if (parentDoc?.source === "manager") continue

      const childDocIds = childCoreIds
        .map((id) => videoMap.get(id))
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
    `[core-sync] Video sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors (${totalSynced}/${coreTotal} = ${successRate})`,
  )

  return stats
}
