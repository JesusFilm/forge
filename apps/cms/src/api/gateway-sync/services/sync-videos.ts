import type { Core } from "@strapi/strapi"
import { queryGateway } from "./gateway-client"
import {
  docs,
  findByGatewayId,
  upsertByGatewayId,
  softDeleteUnseen,
} from "./strapi-helpers"
import type { SyncStats } from "./sync-languages"

const DEFAULT_PAGE_SIZE = 10

function getPageSize(): number {
  const env = process.env.GATEWAY_SYNC_VIDEO_PAGE_SIZE
  return env ? Number(env) : DEFAULT_PAGE_SIZE
}

const BIBLE_BOOKS_QUERY = `
  query {
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
        language { id }
      }
    }
  }
`

type GatewayBibleBook = {
  id: string
  osisId: string
  alternateName: string | null
  paratextAbbreviation: string
  isNewTestament: boolean
  order: number
  name: Array<{ value: string; primary: boolean; language: { id: string } }>
}

type BibleBooksResponse = {
  bibleBooks: GatewayBibleBook[]
}

const VIDEOS_QUERY = `
  query($limit: Int!, $offset: Int!) {
    videos(where: { published: true }, limit: $limit, offset: $offset) {
      id
      slug
      label
      publishedAt
      primaryLanguageId
      locked
      noIndex
      source
      title { id value primary language { id } }
      description { id value primary language { id } }
      snippet { id value primary language { id } }
      studyQuestions { id value primary order language { id } }
      imageAlt { id value primary language { id } }
      bibleCitations {
        id osisId chapterStart chapterEnd verseStart verseEnd order
        bibleBook { id osisId }
      }
      keywords { id value language { id } }
      images {
        id aspectRatio mobileCinematicHigh mobileCinematicLow mobileCinematicVeryLow thumbnail videoStill blurhash url
      }
      variants {
        id slug duration lengthInMilliseconds hls dash share downloadable published brightcoveId
        language { id }
        videoEdition { id name }
        muxVideo { id assetId playbackId }
        downloads { id quality size height width bitrate url }
      }
      subtitles {
        id primary vttSrc srtSrc value
        language { id }
        videoEdition { id name }
      }
      children { id }
    }
  }
`

type GatewayTranslation = {
  id?: string
  value: string
  primary: boolean
  language: { id: string }
}

type GatewayStudyQuestion = GatewayTranslation & {
  order: number
}

type GatewayVideo = {
  id: string
  slug: string
  label: string
  publishedAt: string | null
  primaryLanguageId: string
  locked: boolean
  noIndex: boolean | null
  source: string | null
  title: GatewayTranslation[]
  description: GatewayTranslation[]
  snippet: GatewayTranslation[]
  studyQuestions: GatewayStudyQuestion[]
  imageAlt: GatewayTranslation[]
  bibleCitations: Array<{
    id: string
    osisId: string
    chapterStart: number
    chapterEnd: number | null
    verseStart: number | null
    verseEnd: number | null
    order: number
    bibleBook: { id: string; osisId: string }
  }>
  keywords: Array<{ id: string; value: string; language: { id: string } }>
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
  variants: Array<{
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
  }>
  subtitles: Array<{
    id: string
    primary: boolean
    vttSrc: string | null
    srtSrc: string | null
    value: string
    language: { id: string }
    videoEdition: { id: string; name: string | null } | null
  }>
  children: Array<{ id: string }>
}

type VideosResponse = { videos: GatewayVideo[] }

function getPrimaryValue(translations: GatewayTranslation[]): string {
  const primary = translations.find((t) => t.primary)
  return primary?.value ?? translations[0]?.value ?? ""
}

async function syncSingleVideo(
  strapi: Core.Strapi,
  video: GatewayVideo,
): Promise<"created" | "updated" | "skipped"> {
  // Check if this video is manager-owned
  const existing = await findByGatewayId(
    strapi,
    "api::video.video",
    video.id,
    "en",
  )
  if (existing?.source === "manager") return "skipped"

  // Resolve primary language
  const primaryLangDoc = await findByGatewayId(
    strapi,
    "api::language.language",
    video.primaryLanguageId,
    "en",
  )

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
    primaryLanguageId: video.primaryLanguageId,
    locked: video.locked,
    noIndex: video.noIndex ?? false,
    childGatewayIds: video.children.map((c) => c.id),
    primaryLanguage: primaryLangDoc
      ? { connect: [{ documentId: primaryLangDoc.documentId }] }
      : undefined,
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
          video: { connect: [{ documentId: videoDocId }] },
        },
        { locale: "en" },
      )
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to upsert study question ${sq.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Upsert bible citations as separate collection type records
  for (const bc of video.bibleCitations) {
    try {
      const bookDoc = await findByGatewayId(
        strapi,
        "api::bible-book.bible-book",
        bc.bibleBook.id,
        "en",
      )
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
          bibleBook: bookDoc
            ? { connect: [{ documentId: bookDoc.documentId }] }
            : undefined,
          video: { connect: [{ documentId: videoDocId }] },
        },
      )
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to upsert bible citation ${bc.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Upsert keywords separately, then link to video in a second pass
  const keywordDocIds: Array<{ documentId: string }> = []
  for (const kw of video.keywords) {
    try {
      const langDoc = await findByGatewayId(
        strapi,
        "api::language.language",
        kw.language.id,
        "en",
      )
      const { documentId } = await upsertByGatewayId(
        strapi,
        "api::keyword.keyword",
        kw.id,
        {
          value: kw.value,
          language: langDoc
            ? { connect: [{ documentId: langDoc.documentId }] }
            : undefined,
        },
      )
      keywordDocIds.push({ documentId })
    } catch {
      // skip failed keyword upserts
    }
  }

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
        `[gateway-sync] Failed to link keywords to video ${video.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Pre-pass: upsert all unique VideoEditions and MuxVideos before variants
  const editionMap = new Map<string, string>()
  const muxMap = new Map<string, string>()

  for (const variant of video.variants) {
    if (variant.videoEdition && !editionMap.has(variant.videoEdition.id)) {
      try {
        const { documentId } = await upsertByGatewayId(
          strapi,
          "api::video-edition.video-edition",
          variant.videoEdition.id,
          { name: variant.videoEdition.name ?? undefined },
        )
        editionMap.set(variant.videoEdition.id, documentId)
      } catch (error) {
        strapi.log.warn(
          `[gateway-sync] Failed to upsert edition ${variant.videoEdition.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (variant.muxVideo && !muxMap.has(variant.muxVideo.id)) {
      try {
        const { documentId } = await upsertByGatewayId(
          strapi,
          "api::mux-video.mux-video",
          variant.muxVideo.id,
          {
            assetId: variant.muxVideo.assetId ?? undefined,
            playbackId: variant.muxVideo.playbackId ?? undefined,
          },
        )
        muxMap.set(variant.muxVideo.id, documentId)
      } catch (error) {
        strapi.log.warn(
          `[gateway-sync] Failed to upsert mux video ${variant.muxVideo.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  // Also pre-pass subtitle editions
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

  // Upsert variants (editions and mux videos already exist)
  for (const variant of video.variants) {
    try {
      const langDoc = await findByGatewayId(
        strapi,
        "api::language.language",
        variant.language.id,
        "en",
      )

      const editionDocId = variant.videoEdition
        ? editionMap.get(variant.videoEdition.id)
        : undefined
      const muxDocId = variant.muxVideo
        ? muxMap.get(variant.muxVideo.id)
        : undefined

      const downloads = variant.downloads.map((dl) => ({
        quality: dl.quality,
        size: dl.size,
        height: dl.height,
        width: dl.width,
        bitrate: dl.bitrate,
        url: dl.url,
      }))

      await upsertByGatewayId(
        strapi,
        "api::video-variant.video-variant",
        variant.id,
        {
          slug: variant.slug ?? undefined,
          duration: variant.duration,
          lengthInMilliseconds: variant.lengthInMilliseconds,
          hls: variant.hls ?? undefined,
          dash: variant.dash ?? undefined,
          share: variant.share ?? undefined,
          downloadable: variant.downloadable,
          published: variant.published,
          brightcoveId: variant.brightcoveId ?? undefined,
          language: langDoc
            ? { connect: [{ documentId: langDoc.documentId }] }
            : undefined,
          videoEdition: editionDocId
            ? { connect: [{ documentId: editionDocId }] }
            : undefined,
          muxVideo: muxDocId
            ? { connect: [{ documentId: muxDocId }] }
            : undefined,
          video: { connect: [{ documentId: videoDocId }] },
          downloads,
        },
      )
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to upsert variant ${variant.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Upsert subtitles
  for (const subtitle of video.subtitles) {
    try {
      const langDoc = await findByGatewayId(
        strapi,
        "api::language.language",
        subtitle.language.id,
        "en",
      )

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
          language: langDoc
            ? { connect: [{ documentId: langDoc.documentId }] }
            : undefined,
          videoEdition: editionDocId
            ? { connect: [{ documentId: editionDocId }] }
            : undefined,
          video: { connect: [{ documentId: videoDocId }] },
        },
      )
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to upsert subtitle ${subtitle.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return action === "created"
    ? "created"
    : action === "updated"
      ? "updated"
      : "skipped"
}

export async function syncVideos(strapi: Core.Strapi): Promise<SyncStats> {
  const stats: SyncStats = { created: 0, updated: 0, softDeleted: 0, errors: 0 }
  const pageSize = getPageSize()

  strapi.log.info("[gateway-sync] Starting video sync")

  // First pass: sync all BibleBooks (needed before bible citations)
  try {
    const bibleData = await queryGateway<BibleBooksResponse>(BIBLE_BOOKS_QUERY)
    strapi.log.info(
      `[gateway-sync] Fetched ${bibleData.bibleBooks.length} bible books from gateway`,
    )
    for (const book of bibleData.bibleBooks) {
      const primaryName =
        book.name.find((n) => n.primary)?.value ?? book.name[0]?.value ?? ""
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
      `[gateway-sync] Failed to sync bible books: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const seenVideoIds = new Set<string>()
  const seenVariantIds = new Set<string>()
  const seenSubtitleIds = new Set<string>()
  let offset = 0
  let pageNum = 0
  let totalProcessed = 0

  while (true) {
    pageNum++

    let videos: GatewayVideo[]
    try {
      const data = await queryGateway<VideosResponse>(VIDEOS_QUERY, {
        limit: pageSize,
        offset,
      })
      videos = data.videos
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to fetch video page ${pageNum} (offset ${offset}): ${error instanceof Error ? error.message : String(error)}. Stopping pagination.`,
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

    for (const video of videos) {
      seenVideoIds.add(video.id)
      for (const v of video.variants) seenVariantIds.add(v.id)
      for (const s of video.subtitles) seenSubtitleIds.add(s.id)

      try {
        const result = await syncSingleVideo(strapi, video)
        if (result === "created") stats.created++
        else if (result === "updated") stats.updated++
      } catch (error) {
        stats.errors++
        strapi.log.warn(
          `[gateway-sync] Failed to sync video ${video.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    totalProcessed += videos.length
    strapi.log.info(
      `[gateway-sync] Videos: page ${pageNum} processed (${totalProcessed} total so far)`,
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
      "api::video-variant.video-variant",
      seenVariantIds,
    )
    stats.softDeleted += await softDeleteUnseen(
      strapi,
      "api::video-subtitle.video-subtitle",
      seenSubtitleIds,
    )
  }

  strapi.log.info(
    `[gateway-sync] Video sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors`,
  )

  return stats
}
