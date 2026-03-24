import type { Core } from "@strapi/strapi"
import type { ResultOf } from "@graphql-typed-document-node/core"
import { gql } from "@apollo/client/core"
import { getGatewayClient } from "./gateway-client"
import { graphql } from "../gql"
import type { SyncSelection } from "./gateway-sync"
import {
  type SyncStats,
  docs,
  getPrimaryValue,
  formatError,
  findByGatewayId,
  upsertByGatewayId,
  softDeleteUnseen,
  buildGatewayIdMap,
  clearableRelation,
} from "./strapi-helpers"

const DEFAULT_PAGE_SIZE = 100

function getPageSize(): number {
  const env = process.env.GATEWAY_SYNC_VIDEO_PAGE_SIZE
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

type GatewayVideo = ResultOf<typeof VIDEOS_QUERY>["videos"][number]

/**
 * Selected-video query for limited imports.
 * Fetches videos by ID with nested variants so we don't need a separate variant crawl.
 * Uses `gql` from Apollo directly since this query shape is unique to limited imports.
 */
const SELECTED_VIDEOS_QUERY = gql`
  query SelectedVideos($ids: [ID!]!) {
    videos(where: { ids: $ids, published: true }, limit: 2000) {
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
      variants {
        id
        slug
        duration
        lengthInMilliseconds
        hls
        dash
        share
        downloadable
        published
        brightcoveId
        language {
          id
        }
        videoEdition {
          id
          name
        }
        muxVideo {
          id
          assetId
          playbackId
        }
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

/** Variant shape nested inside the selected-videos query */
export type SelectedVideoVariant = {
  id: string
  slug: string | null
  duration: number
  lengthInMilliseconds: number
  hls: string | null
  dash: string | null
  share: string | null
  downloadable: boolean
  published: boolean
  brightcoveId: string | null
  language: { id: string }
  videoEdition: { id: string; name: string | null } | null
  muxVideo: {
    id: string
    assetId: string | null
    playbackId: string | null
  } | null
  downloads: Array<{
    id: string
    quality: string
    size: number
    height: number
    width: number
    bitrate: number
    url: string
  }>
}

type SelectedVideo = GatewayVideo & {
  variants: SelectedVideoVariant[]
}

async function syncSingleVideo(
  strapi: Core.Strapi,
  video: GatewayVideo,
  caches: {
    originMap: Map<string, string>
    languageMap: Map<string, string>
    bibleBookMap: Map<string, string>
    keywordMap: Map<string, string>
  },
): Promise<"created" | "updated" | "skipped"> {
  // Check if this video is manager-owned (early exit to skip all sub-entity work)
  const existing = await findByGatewayId(
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
    childGatewayIds: video.children.map((c) => c.id),
    origin: video.origin
      ? clearableRelation(caches.originMap.get(video.origin.id))
      : { set: [] },
    primaryLanguage: clearableRelation(primaryLangDocId),
    images,
  }

  const { documentId: videoDocId, action } = await upsertByGatewayId(
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
      await upsertByGatewayId(
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
        `[gateway-sync] Failed to upsert study question ${sq.id} (video=${video.id}, videoDocId=${videoDocId}, action=${action}): ${formatError(error)}`,
      )
    }
  }

  // Upsert bible citations as separate collection type records
  for (const bc of video.bibleCitations) {
    try {
      const bookDocId = caches.bibleBookMap.get(bc.bibleBook.id)
      await upsertByGatewayId(
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
        `[gateway-sync] Failed to upsert bible citation ${bc.id}: ${formatError(error)}`,
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
        `[gateway-sync] Failed to link keywords to video ${video.id}: ${formatError(error)}`,
      )
    }
  }

  // Pre-pass: upsert subtitle editions
  const editionMap = new Map<string, string>()
  for (const subtitle of video.subtitles) {
    if (subtitle.videoEdition && !editionMap.has(subtitle.videoEdition.id)) {
      try {
        const { documentId } = await upsertByGatewayId(
          strapi,
          "api::video-edition.video-edition",
          subtitle.videoEdition.id,
          { name: subtitle.videoEdition.name ?? undefined },
        )
        editionMap.set(subtitle.videoEdition.id, documentId)
      } catch (error) {
        strapi.log.warn(
          `[gateway-sync] Failed to upsert edition ${subtitle.videoEdition.id}: ${error instanceof Error ? error.message : String(error)}`,
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

      await upsertByGatewayId(
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
        `[gateway-sync] Failed to upsert subtitle ${subtitle.id}: ${formatError(error)}`,
      )
    }
  }

  return action === "created"
    ? "created"
    : action === "updated"
      ? "updated"
      : "skipped"
}

/**
 * Full sync: paginate all published videos from gateway.
 * Limited sync: fetch only the resolved selected video IDs.
 */
export async function syncVideos(
  strapi: Core.Strapi,
  selection: SyncSelection,
): Promise<SyncStats> {
  const stats: SyncStats = { created: 0, updated: 0, softDeleted: 0, errors: 0 }
  const pageSize = getPageSize()

  strapi.log.info(
    `[gateway-sync] Starting video sync (${selection.isFullSync ? "full" : "limited"})`,
  )

  // First pass: sync all BibleBooks (needed before bible citations)
  try {
    const bibleData = (
      await getGatewayClient().query({ query: BIBLE_BOOKS_QUERY })
    ).data
    strapi.log.info(
      `[gateway-sync] Fetched ${bibleData.bibleBooks.length} bible books from gateway`,
    )
    for (const book of bibleData.bibleBooks) {
      const primaryName = getPrimaryValue(book.name)
      await upsertByGatewayId(
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
      `[gateway-sync] Failed to sync bible books: ${formatError(error)}`,
    )
  }

  // Pre-load lookup caches to avoid N+1 queries in per-video loops
  const languageMap = await buildGatewayIdMap(
    strapi,
    "api::language.language",
    "en",
  )
  const bibleBookMap = await buildGatewayIdMap(
    strapi,
    "api::bible-book.bible-book",
    "en",
  )
  const keywordMap = await buildGatewayIdMap(strapi, "api::keyword.keyword")
  const originMap = new Map<string, string>() // built incrementally from video pages

  strapi.log.info(
    `[gateway-sync] Loaded caches: ${languageMap.size} languages, ${bibleBookMap.size} bible books, ${keywordMap.size} keywords`,
  )

  const caches = { originMap, languageMap, bibleBookMap, keywordMap }

  // Branch: limited vs full sync
  if (!selection.isFullSync) {
    return syncVideosLimited(strapi, selection, stats, caches)
  }

  return syncVideosFull(strapi, stats, pageSize, caches)
}

/** Full sync: paginate all published videos, soft-delete unseen */
async function syncVideosFull(
  strapi: Core.Strapi,
  stats: SyncStats,
  pageSize: number,
  caches: {
    originMap: Map<string, string>
    languageMap: Map<string, string>
    bibleBookMap: Map<string, string>
    keywordMap: Map<string, string>
  },
): Promise<SyncStats> {
  // Get total count from gateway for comparison
  let gatewayTotal = 0
  try {
    const { data: countData } = await getGatewayClient().query({
      query: VIDEOS_COUNT_QUERY,
    })
    gatewayTotal = countData.videosCount
    strapi.log.info(
      `[gateway-sync] Gateway reports ${gatewayTotal} published videos`,
    )
  } catch (error) {
    strapi.log.warn(
      `[gateway-sync] Failed to fetch video count: ${formatError(error)}`,
    )
  }

  const seenVideoIds = new Set<string>()
  const seenSubtitleIds = new Set<string>()
  let offset = 0
  let totalProcessed = 0

  while (true) {
    let videos: GatewayVideo[]
    try {
      const { data } = await getGatewayClient().query({
        query: VIDEOS_QUERY,
        variables: {
          limit: pageSize,
          offset,
        },
      })
      videos = data.videos
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to fetch video page (offset ${offset}): ${formatError(error)}. Stopping pagination.`,
      )
      break
    }

    // Circuit breaker: gateway returned 0 on first page
    if (videos.length === 0 && offset === 0) {
      strapi.log.error(
        "[gateway-sync] Gateway returned 0 videos on first page — circuit breaker: skipping sync",
      )
      return stats
    }

    if (videos.length === 0) break

    // Pre-pass: upsert all VideoOrigins from this page (hoisted map persists across pages)
    for (const video of videos) {
      if (video.origin && !caches.originMap.has(video.origin.id)) {
        try {
          const { documentId } = await upsertByGatewayId(
            strapi,
            "api::video-origin.video-origin",
            video.origin.id,
            {
              name: video.origin.name,
              description: video.origin.description ?? undefined,
            },
          )
          caches.originMap.set(video.origin.id, documentId)
        } catch (error) {
          strapi.log.warn(
            `[gateway-sync] Failed to upsert video origin ${video.origin.id}: ${formatError(error)}`,
          )
        }
      }
    }

    for (const video of videos) {
      seenVideoIds.add(video.id)
      for (const s of video.subtitles) seenSubtitleIds.add(s.id)

      try {
        const result = await syncSingleVideo(strapi, video, caches)
        if (result === "created") stats.created++
        else if (result === "updated") stats.updated++
      } catch (error) {
        stats.errors++
        strapi.log.warn(
          `[gateway-sync] Failed to sync video ${video.id}: ${formatError(error)}`,
        )
      }
    }

    totalProcessed += videos.length
    const pct = gatewayTotal
      ? `${((totalProcessed / gatewayTotal) * 100).toFixed(1)}%`
      : "?"
    strapi.log.info(
      `[gateway-sync] Videos: ${totalProcessed}/${gatewayTotal} (${pct}) processed so far`,
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

  const totalSynced = stats.created + stats.updated
  const successRate = gatewayTotal
    ? `${((totalSynced / gatewayTotal) * 100).toFixed(1)}%`
    : "N/A"

  strapi.log.info(
    `[gateway-sync] Video sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors (${totalSynced}/${gatewayTotal} = ${successRate})`,
  )

  return stats
}

/**
 * Limited sync: fetch only selected videos by ID, including nested variants.
 * No soft-delete — limited imports are always additive.
 * Returns collected variant data for the variant phase to consume.
 */
/** Batch size for SELECTED_VIDEOS_QUERY to stay under gateway complexity limits */
const SELECTED_VIDEOS_BATCH_SIZE = 10

async function fetchSelectedVideosBatched(
  strapi: Core.Strapi,
  ids: string[],
): Promise<SelectedVideo[]> {
  const allVideos: SelectedVideo[] = []
  const batches: string[][] = []

  for (let i = 0; i < ids.length; i += SELECTED_VIDEOS_BATCH_SIZE) {
    batches.push(ids.slice(i, i + SELECTED_VIDEOS_BATCH_SIZE))
  }

  strapi.log.info(
    `[gateway-sync] Fetching ${ids.length} selected videos in ${batches.length} batches of up to ${SELECTED_VIDEOS_BATCH_SIZE}`,
  )

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const { data, error } = await getGatewayClient().query<{
      videos: SelectedVideo[]
    }>({
      query: SELECTED_VIDEOS_QUERY,
      variables: { ids: batch },
    })

    if (error) {
      strapi.log.warn(
        `[gateway-sync] Batch ${i + 1}/${batches.length} returned errors: ${error.message}`,
      )
    }

    const videos = data?.videos
    if (videos) {
      allVideos.push(...videos)
    } else {
      strapi.log.error(
        `[gateway-sync] Batch ${i + 1}/${batches.length} returned null data — skipping ${batch.length} IDs`,
      )
    }
  }

  return allVideos
}

async function syncVideosLimited(
  strapi: Core.Strapi,
  selection: SyncSelection,
  stats: SyncStats,
  caches: {
    originMap: Map<string, string>
    languageMap: Map<string, string>
    bibleBookMap: Map<string, string>
    keywordMap: Map<string, string>
  },
): Promise<SyncStats> {
  strapi.log.info(
    `[gateway-sync] Fetching ${selection.resolvedVideoIds.length} selected videos from gateway`,
  )

  let videos: SelectedVideo[]
  try {
    videos = await fetchSelectedVideosBatched(
      strapi,
      selection.resolvedVideoIds,
    )
  } catch (error) {
    strapi.log.error(
      `[gateway-sync] Failed to fetch selected videos: ${formatError(error)}`,
    )
    return stats
  }

  strapi.log.info(
    `[gateway-sync] Gateway returned ${videos.length} of ${selection.resolvedVideoIds.length} requested videos`,
  )

  // Pre-pass: upsert all VideoOrigins
  for (const video of videos) {
    if (video.origin && !caches.originMap.has(video.origin.id)) {
      try {
        const { documentId } = await upsertByGatewayId(
          strapi,
          "api::video-origin.video-origin",
          video.origin.id,
          {
            name: video.origin.name,
            description: video.origin.description ?? undefined,
          },
        )
        caches.originMap.set(video.origin.id, documentId)
      } catch (error) {
        strapi.log.warn(
          `[gateway-sync] Failed to upsert video origin ${video.origin.id}: ${formatError(error)}`,
        )
      }
    }
  }

  // Collect variant data for the variant sync phase
  const collectedVariants: Array<{
    variant: SelectedVideoVariant
    videoGatewayId: string
  }> = []

  for (const video of videos) {
    try {
      const result = await syncSingleVideo(strapi, video, caches)
      if (result === "created") stats.created++
      else if (result === "updated") stats.updated++

      // Collect variants from this video for the variant phase
      for (const variant of video.variants) {
        collectedVariants.push({ variant, videoGatewayId: video.id })
      }
    } catch (error) {
      stats.errors++
      strapi.log.warn(
        `[gateway-sync] Failed to sync video ${video.id}: ${formatError(error)}`,
      )
    }
  }

  // Store collected variants on the selection for the variant phase to consume
  ;(
    selection as SyncSelection & { _collectedVariants?: unknown }
  )._collectedVariants = collectedVariants

  // No soft-delete for limited imports
  strapi.log.info(
    `[gateway-sync] Limited video sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.errors} errors (soft-delete skipped)`,
  )

  return stats
}
