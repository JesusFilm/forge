import type { Core } from "@strapi/strapi"
import { queryGateway } from "./gateway-client"
import {
  findByGatewayId,
  upsertByGatewayId,
  softDeleteUnseen,
} from "./strapi-helpers"
import type { SyncStats } from "./sync-languages"

const DEFAULT_PAGE_SIZE = 50

function getPageSize(): number {
  const env = process.env.GATEWAY_SYNC_VIDEO_PAGE_SIZE
  return env ? Number(env) : DEFAULT_PAGE_SIZE
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
      childrenCount
      availableLanguages
      source
      title(primary: true) { value primary language { id } }
      description(primary: true) { value primary language { id } }
      snippet(primary: true) { value primary language { id } }
      studyQuestions(primary: true) { value primary language { id } }
      imageAlt(primary: true) { value primary language { id } }
      bibleCitations {
        id osisId chapterStart chapterEnd verseStart verseEnd order
        bibleBook { id osisId }
      }
      keywords { id value language { id } }
      images(aspectRatio: banner) {
        id mobileCinematicHigh mobileCinematicLow mobileCinematicVeryLow thumbnail videoStill
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
      parents { id }
    }
  }
`

type GatewayTranslation = {
  value: string
  primary: boolean
  language: { id: string }
}

type GatewayVideo = {
  id: string
  slug: string
  label: string
  publishedAt: string | null
  primaryLanguageId: string
  locked: boolean
  noIndex: boolean | null
  childrenCount: number
  availableLanguages: string[]
  source: string | null
  title: GatewayTranslation[]
  description: GatewayTranslation[]
  snippet: GatewayTranslation[]
  studyQuestions: GatewayTranslation[]
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
    mobileCinematicHigh: string | null
    mobileCinematicLow: string | null
    mobileCinematicVeryLow: string | null
    thumbnail: string | null
    videoStill: string | null
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
  parents: Array<{ id: string }>
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

  // Build images
  const images = video.images.map((img) => ({
    cloudflareId: img.id,
    aspectRatio: "banner",
    mobileCinematicHigh: img.mobileCinematicHigh ?? undefined,
    mobileCinematicLow: img.mobileCinematicLow ?? undefined,
    mobileCinematicVeryLow: img.mobileCinematicVeryLow ?? undefined,
    thumbnail: img.thumbnail ?? undefined,
    videoStill: img.videoStill ?? undefined,
  }))

  // Build bible citations
  const bibleCitations = await Promise.all(
    video.bibleCitations.map(async (bc) => {
      const bookDoc = await findByGatewayId(
        strapi,
        "api::bible-book.bible-book",
        bc.bibleBook.id,
        "en",
      )
      return {
        osisId: bc.osisId,
        chapterStart: bc.chapterStart,
        chapterEnd: bc.chapterEnd ?? undefined,
        verseStart: bc.verseStart ?? undefined,
        verseEnd: bc.verseEnd ?? undefined,
        order: bc.order,
        bibleBook: bookDoc ? { documentId: bookDoc.documentId } : undefined,
      }
    }),
  )

  // Upsert keywords
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
          language: langDoc ? { documentId: langDoc.documentId } : undefined,
        },
      )
      keywordDocIds.push({ documentId })
    } catch {
      // skip failed keyword upserts
    }
  }

  const studyQuestions = video.studyQuestions.map((sq) => sq.value)

  const videoData = {
    title: getPrimaryValue(video.title),
    slug: video.slug,
    description: getPrimaryValue(video.description),
    snippet: getPrimaryValue(video.snippet),
    studyQuestions: studyQuestions.length > 0 ? studyQuestions : undefined,
    imageAlt: getPrimaryValue(video.imageAlt),
    label: video.label,
    videoSource: video.source ?? undefined,
    primaryLanguageId: video.primaryLanguageId,
    locked: video.locked,
    noIndex: video.noIndex ?? false,
    childrenCount: video.childrenCount,
    childGatewayIds: video.children.map((c) => c.id),
    parentGatewayIds: video.parents.map((p) => p.id),
    availableLanguages: video.availableLanguages,
    primaryLanguage: primaryLangDoc
      ? { documentId: primaryLangDoc.documentId }
      : undefined,
    images,
    bibleCitations,
    keywords: keywordDocIds,
  }

  const { documentId: videoDocId, action } = await upsertByGatewayId(
    strapi,
    "api::video.video",
    video.id,
    videoData,
    { locale: "en" },
  )

  // Upsert variants
  for (const variant of video.variants) {
    try {
      const langDoc = await findByGatewayId(
        strapi,
        "api::language.language",
        variant.language.id,
        "en",
      )

      let editionDocId: string | undefined
      if (variant.videoEdition) {
        const result = await upsertByGatewayId(
          strapi,
          "api::video-edition.video-edition",
          variant.videoEdition.id,
          { name: variant.videoEdition.name ?? undefined },
        )
        editionDocId = result.documentId
      }

      let muxDocId: string | undefined
      if (variant.muxVideo) {
        const result = await upsertByGatewayId(
          strapi,
          "api::mux-video.mux-video",
          variant.muxVideo.id,
          {
            assetId: variant.muxVideo.assetId ?? undefined,
            playbackId: variant.muxVideo.playbackId ?? undefined,
          },
        )
        muxDocId = result.documentId
      }

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
          language: langDoc ? { documentId: langDoc.documentId } : undefined,
          videoEdition: editionDocId ? { documentId: editionDocId } : undefined,
          muxVideo: muxDocId ? { documentId: muxDocId } : undefined,
          video: { documentId: videoDocId },
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

      let editionDocId: string | undefined
      if (subtitle.videoEdition) {
        const result = await upsertByGatewayId(
          strapi,
          "api::video-edition.video-edition",
          subtitle.videoEdition.id,
          { name: subtitle.videoEdition.name ?? undefined },
        )
        editionDocId = result.documentId
      }

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
          language: langDoc ? { documentId: langDoc.documentId } : undefined,
          videoEdition: editionDocId ? { documentId: editionDocId } : undefined,
          video: { documentId: videoDocId },
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

  const seenVideoIds = new Set<string>()
  const seenVariantIds = new Set<string>()
  const seenSubtitleIds = new Set<string>()
  let offset = 0
  let pageNum = 0
  let totalProcessed = 0

  while (true) {
    pageNum++
    const data = await queryGateway<VideosResponse>(VIDEOS_QUERY, {
      limit: pageSize,
      offset,
    })
    const videos = data.videos

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
