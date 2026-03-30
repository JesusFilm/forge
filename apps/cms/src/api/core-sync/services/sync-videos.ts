import type { Core } from "@strapi/strapi"
import type { ResultOf } from "@graphql-typed-document-node/core"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  getPrimaryValue,
  formatError,
  softDeleteUnseen,
} from "./strapi-helpers"
import { bulkUpsertByCoreId, type BulkRecord } from "./bulk-upsert"

const DEFAULT_PAGE_SIZE = 500

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

  // Sync BibleBooks via bulk upsert (small set, only on full sync)
  if (!isIncremental) {
    try {
      const bibleData = (
        await getCoreClient().query({ query: BIBLE_BOOKS_QUERY })
      ).data
      strapi.log.info(
        `[core-sync] Fetched ${bibleData.bibleBooks.length} bible books from core`,
      )
      const bibleBookRecords: Array<{
        coreId: string
        data: Record<string, unknown>
      }> = bibleData.bibleBooks.map((book) => ({
        coreId: book.id,
        data: {
          name: getPrimaryValue(book.name),
          osis_id: book.osisId,
          alternate_name: book.alternateName ?? null,
          paratext_abbreviation: book.paratextAbbreviation,
          is_new_testament: book.isNewTestament,
          order: book.order,
        },
      }))
      if (bibleBookRecords.length > 0) {
        await bulkUpsertByCoreId(
          strapi,
          { tableName: "bible_books", locale: "en", linkConfigs: [] },
          bibleBookRecords,
        )
      }
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to sync bible books: ${formatError(error)}`,
      )
    }
  }

  // Pre-load lookup caches
  const knex = strapi.db.connection

  const languageRows: Array<{ core_id: string; document_id: string }> =
    await knex("languages")
      .select("core_id", "document_id")
      .where("locale", "en")
      .whereNotNull("core_id")
      .groupBy("core_id", "document_id")
  const languageMap = new Map<string, string>()
  for (const row of languageRows) languageMap.set(row.core_id, row.document_id)

  const bibleBookRows: Array<{ core_id: string; document_id: string }> =
    await knex("bible_books")
      .select("core_id", "document_id")
      .where("locale", "en")
      .whereNotNull("core_id")
      .groupBy("core_id", "document_id")
  const bibleBookMap = new Map<string, string>()
  for (const row of bibleBookRows)
    bibleBookMap.set(row.core_id, row.document_id)

  const keywordRows: Array<{ core_id: string; document_id: string }> =
    await knex("keywords")
      .select("core_id", "document_id")
      .whereNotNull("core_id")
      .groupBy("core_id", "document_id")
  const keywordMap = new Map<string, string>()
  for (const row of keywordRows) keywordMap.set(row.core_id, row.document_id)

  strapi.log.info(
    `[core-sync] Loaded caches: ${languageMap.size} languages, ${bibleBookMap.size} bible books, ${keywordMap.size} keywords`,
  )

  // Dedup origins and editions (small cardinality, accumulated across pages)
  const originMap = new Map<string, string>()
  const editionMap = new Map<string, string>()

  const seenVideoIds = new Set<string>()
  const seenSubtitleIds = new Set<string>()
  const seenImageIds = new Set<string>()
  const seenStudyQuestionIds = new Set<string>()
  const seenCitationIds = new Set<string>()
  const parentChildMap = new Map<string, string[]>()

  // Track keyword links per video: videoCoreId -> keywordCoreIds
  const videoKeywordLinks = new Map<string, string[]>()

  // Running map of video coreId -> documentId, accumulated across pages
  const videoDocMap = new Map<string, string>()

  // Link configs (reused each page iteration)
  const videoLinkConfigs = [
    {
      linkTable: "videos_origin_lnk",
      sourceColumn: "video_id",
      targetTable: "video_origins",
      targetColumn: "video_origin_id",
      targetLocale: "",
      orderColumn: "video_ord",
    },
    {
      linkTable: "videos_primary_language_lnk",
      sourceColumn: "video_id",
      targetTable: "languages",
      targetColumn: "language_id",
      targetLocale: "en",
      orderColumn: "video_ord",
    },
  ]

  const imageLinkConfigs = [
    {
      linkTable: "video_images_video_lnk",
      sourceColumn: "video_image_id",
      targetTable: "videos",
      targetColumn: "video_id",
      targetLocale: "en",
      orderColumn: "video_image_ord",
    },
  ]

  const studyQuestionLinkConfigs = [
    {
      linkTable: "video_study_questions_video_lnk",
      sourceColumn: "video_study_question_id",
      targetTable: "videos",
      targetColumn: "video_id",
      targetLocale: "en",
      orderColumn: "video_study_question_ord",
    },
  ]

  const citationLinkConfigs = [
    {
      linkTable: "bible_citations_bible_book_lnk",
      sourceColumn: "bible_citation_id",
      targetTable: "bible_books",
      targetColumn: "bible_book_id",
      targetLocale: "en",
      orderColumn: "bible_citation_ord",
    },
    {
      linkTable: "bible_citations_video_lnk",
      sourceColumn: "bible_citation_id",
      targetTable: "videos",
      targetColumn: "video_id",
      targetLocale: "en",
      orderColumn: "bible_citation_ord",
    },
  ]

  const subtitleLinkConfigs = [
    {
      linkTable: "video_subtitles_language_lnk",
      sourceColumn: "video_subtitle_id",
      targetTable: "languages",
      targetColumn: "language_id",
      targetLocale: "en",
      orderColumn: "video_subtitle_ord",
    },
    {
      linkTable: "video_subtitles_video_edition_lnk",
      sourceColumn: "video_subtitle_id",
      targetTable: "video_editions",
      targetColumn: "video_edition_id",
      targetLocale: "",
      orderColumn: "video_subtitle_ord",
    },
    {
      linkTable: "video_subtitles_video_lnk",
      sourceColumn: "video_subtitle_id",
      targetTable: "videos",
      targetColumn: "video_id",
      targetLocale: "en",
      orderColumn: "video_subtitle_ord",
    },
  ]

  let offset = 0
  let totalFetched = 0

  // Prefetch: kick off the first page fetch
  let pendingFetch: Promise<CoreVideo[]> | null = null

  function fetchPage(pageOffset: number): Promise<CoreVideo[]> {
    const fetchStart = Date.now()
    return getCoreClient()
      .query({
        query: VIDEOS_QUERY,
        variables: { limit: pageSize, offset: pageOffset, where },
      })
      .then(({ data }) => {
        const fetchMs = Date.now() - fetchStart
        strapi.log.info(
          `[core-sync] [timing] fetch page offset=${pageOffset}: ${fetchMs}ms (${data.videos.length} records)`,
        )
        return data.videos
      })
  }

  pendingFetch = fetchPage(offset)

  // ── Main loop: fetch, upsert per page ──────────────────────────────────
  while (true) {
    const pageStart = Date.now()
    let videos: CoreVideo[]
    try {
      videos = await pendingFetch!
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

    // Prefetch next page while we process this one
    const hasMore = videos.length === pageSize
    if (hasMore) {
      pendingFetch = fetchPage(offset + pageSize)
    }

    // ── Bulk upsert origins and editions for this page ────────────────
    const originEditionStart = Date.now()
    const pageOriginRecords: Array<{
      coreId: string
      data: Record<string, unknown>
    }> = []
    const pageEditionRecords: Array<{
      coreId: string
      data: Record<string, unknown>
    }> = []

    for (const video of videos) {
      if (video.origin && !originMap.has(video.origin.id)) {
        pageOriginRecords.push({
          coreId: video.origin.id,
          data: {
            name: video.origin.name,
            description: video.origin.description ?? null,
          },
        })
        originMap.set(video.origin.id, "") // placeholder
      }
      for (const sub of video.subtitles) {
        if (sub.videoEdition && !editionMap.has(sub.videoEdition.id)) {
          pageEditionRecords.push({
            coreId: sub.videoEdition.id,
            data: { name: sub.videoEdition.name ?? null },
          })
          editionMap.set(sub.videoEdition.id, "") // placeholder
        }
      }
    }

    if (pageOriginRecords.length > 0) {
      await bulkUpsertByCoreId(
        strapi,
        { tableName: "video_origins", locale: "", linkConfigs: [] },
        pageOriginRecords,
      )
      const originCoreIds = pageOriginRecords.map((r) => r.coreId)
      const originRows: Array<{ core_id: string; document_id: string }> =
        await knex("video_origins")
          .select("core_id", "document_id")
          .whereIn("core_id", originCoreIds)
          .where("locale", "")
          .groupBy("core_id", "document_id")
      for (const row of originRows) {
        originMap.set(row.core_id, row.document_id)
      }
    }

    if (pageEditionRecords.length > 0) {
      await bulkUpsertByCoreId(
        strapi,
        { tableName: "video_editions", locale: "", linkConfigs: [] },
        pageEditionRecords,
      )
      const edCoreIds = pageEditionRecords.map((r) => r.coreId)
      const edRows: Array<{ core_id: string; document_id: string }> =
        await knex("video_editions")
          .select("core_id", "document_id")
          .whereIn("core_id", edCoreIds)
          .where("locale", "")
          .groupBy("core_id", "document_id")
      for (const row of edRows) {
        editionMap.set(row.core_id, row.document_id)
      }
    }

    const originEditionMs = Date.now() - originEditionStart
    if (originEditionMs > 50) {
      strapi.log.info(
        `[core-sync] [timing] origin/edition bulk upserts: ${originEditionMs}ms (${pageOriginRecords.length} origins, ${pageEditionRecords.length} editions)`,
      )
    }

    // ── Build page-scoped records ─────────────────────────────────────
    const pageVideoRecords: BulkRecord[] = []
    const pageImageRecords: BulkRecord[] = []
    const pageSubtitleRecords: BulkRecord[] = []
    const pageStudyQuestionRecords: BulkRecord[] = []
    const pageCitationRecords: BulkRecord[] = []

    for (const video of videos) {
      seenVideoIds.add(video.id)

      const childIds = video.children.map((c) => c.id)
      if (childIds.length > 0) parentChildMap.set(video.id, childIds)

      const primaryLangDocId = languageMap.get(video.primaryLanguageId)
      const originDocId = video.origin
        ? originMap.get(video.origin.id)
        : undefined

      pageVideoRecords.push({
        coreId: video.id,
        data: {
          title: getPrimaryValue(video.title),
          slug: video.slug,
          description: getPrimaryValue(video.description),
          snippet: getPrimaryValue(video.snippet),
          image_alt: getPrimaryValue(video.imageAlt),
          label: video.label,
          video_source: video.source ?? null,
          locked: video.locked,
          no_index: video.noIndex ?? false,
        },
        links: {
          videos_origin_lnk: originDocId,
          videos_primary_language_lnk: primaryLangDocId,
        },
      })

      // Keyword links
      const kwIds = video.keywords.map((kw) => kw.id).filter(Boolean)
      if (kwIds.length > 0) videoKeywordLinks.set(video.id, kwIds)

      // Images
      for (const img of video.images) {
        seenImageIds.add(img.id)
        pageImageRecords.push({
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
            _videoCoreId: video.id,
          } as Record<string, string | undefined>,
        })
      }

      // Study questions
      for (const sq of video.studyQuestions) {
        if (!sq.id) continue
        seenStudyQuestionIds.add(sq.id)
        pageStudyQuestionRecords.push({
          coreId: sq.id,
          data: {
            value: sq.value,
            order: sq.order,
          },
          links: {
            _videoCoreId: video.id,
          } as Record<string, string | undefined>,
        })
      }

      // Bible citations
      for (const bc of video.bibleCitations) {
        seenCitationIds.add(bc.id)
        pageCitationRecords.push({
          coreId: bc.id,
          data: {
            osis_id: bc.osisId,
            chapter_start: bc.chapterStart,
            chapter_end: bc.chapterEnd ?? null,
            verse_start: bc.verseStart ?? null,
            verse_end: bc.verseEnd ?? null,
            order: bc.order,
          },
          links: {
            bible_citations_bible_book_lnk: bibleBookMap.get(bc.bibleBook.id),
            _videoCoreId: video.id,
          } as Record<string, string | undefined>,
        })
      }

      // Subtitles
      for (const sub of video.subtitles) {
        seenSubtitleIds.add(sub.id)
        const editionDocId = sub.videoEdition
          ? editionMap.get(sub.videoEdition.id)
          : undefined
        pageSubtitleRecords.push({
          coreId: sub.id,
          data: {
            primary: sub.primary,
            vtt_src: sub.vttSrc ?? null,
            srt_src: sub.srtSrc ?? null,
            value: sub.value,
            edition: sub.videoEdition?.name ?? null,
          },
          links: {
            video_subtitles_language_lnk: languageMap.get(sub.language.id),
            video_subtitles_video_edition_lnk: editionDocId,
            _videoCoreId: video.id,
          } as Record<string, string | undefined>,
        })
      }
    }

    // ── Bulk upsert videos for this page ──────────────────────────────
    const videoUpsertStart = Date.now()
    if (pageVideoRecords.length > 0) {
      const videoStats = await bulkUpsertByCoreId(
        strapi,
        {
          tableName: "videos",
          locale: "en",
          linkConfigs: videoLinkConfigs,
        },
        pageVideoRecords,
        progress,
      )
      stats.created += videoStats.created
      stats.updated += videoStats.updated
      stats.errors += videoStats.errors
    }
    const videoUpsertMs = Date.now() - videoUpsertStart

    // ── Query video documentIds for this page's coreIds ───────────────
    const resolveStart = Date.now()
    if (pageVideoRecords.length > 0) {
      const pageCoreIds = pageVideoRecords.map((r) => r.coreId)
      const videoRows: Array<{ core_id: string; document_id: string }> =
        await knex("videos")
          .select("core_id", "document_id")
          .whereIn("core_id", pageCoreIds)
          .where("locale", "en")
          .groupBy("core_id", "document_id")
      for (const row of videoRows) {
        videoDocMap.set(row.core_id, row.document_id)
      }
    }

    // Resolve _videoCoreId placeholders to actual documentIds
    function resolveVideoLinks(records: BulkRecord[], linkTableName: string) {
      for (const rec of records) {
        const videoCoreId = (rec.links as Record<string, string>)?._videoCoreId
        if (videoCoreId) {
          delete rec.links!._videoCoreId
          rec.links![linkTableName] = videoDocMap.get(videoCoreId)
        }
      }
    }

    // ── Bulk upsert sub-entities for this page ────────────────────────
    resolveVideoLinks(pageImageRecords, "video_images_video_lnk")
    resolveVideoLinks(
      pageStudyQuestionRecords,
      "video_study_questions_video_lnk",
    )
    resolveVideoLinks(pageCitationRecords, "bible_citations_video_lnk")
    resolveVideoLinks(pageSubtitleRecords, "video_subtitles_video_lnk")

    const subEntityStart = Date.now()

    if (pageImageRecords.length > 0) {
      const imgStats = await bulkUpsertByCoreId(
        strapi,
        {
          tableName: "video_images",
          locale: "",
          linkConfigs: imageLinkConfigs,
        },
        pageImageRecords,
      )
      stats.errors += imgStats.errors
    }

    if (pageStudyQuestionRecords.length > 0) {
      const sqStats = await bulkUpsertByCoreId(
        strapi,
        {
          tableName: "video_study_questions",
          locale: "en",
          linkConfigs: studyQuestionLinkConfigs,
        },
        pageStudyQuestionRecords,
      )
      stats.errors += sqStats.errors
    }

    if (pageCitationRecords.length > 0) {
      const bcStats = await bulkUpsertByCoreId(
        strapi,
        {
          tableName: "bible_citations",
          locale: "",
          linkConfigs: citationLinkConfigs,
        },
        pageCitationRecords,
      )
      stats.errors += bcStats.errors
    }

    if (pageSubtitleRecords.length > 0) {
      const subStats = await bulkUpsertByCoreId(
        strapi,
        {
          tableName: "video_subtitles",
          locale: "",
          linkConfigs: subtitleLinkConfigs,
        },
        pageSubtitleRecords,
      )
      stats.errors += subStats.errors
    }

    const subEntityMs = Date.now() - subEntityStart
    const resolveMs = Date.now() - resolveStart
    const pageMs = Date.now() - pageStart

    totalFetched += videos.length
    const pct = coreTotal
      ? `${((totalFetched / coreTotal) * 100).toFixed(1)}%`
      : "?"
    strapi.log.info(
      `[core-sync] Videos: ${totalFetched}/${coreTotal} (${pct}) — page: ${pageVideoRecords.length}v/${pageImageRecords.length}img/${pageSubtitleRecords.length}sub/${pageStudyQuestionRecords.length}sq/${pageCitationRecords.length}bc — timing: page=${pageMs}ms video_upsert=${videoUpsertMs}ms resolve=${resolveMs}ms sub_entities=${subEntityMs}ms`,
    )

    if (videos.length < pageSize) break
    offset += pageSize
  }

  // ── Phase 7: Link keywords (manyToMany via raw SQL) ───────────────────
  if (videoKeywordLinks.size > 0) {
    const linkRows: Array<{
      video_id: number
      keyword_id: number
      video_ord: number
      keyword_ord: number
    }> = []

    // Load video and keyword row IDs for link table
    const videoRows: Array<{
      id: number
      document_id: string
      published_at: string | null
    }> = await knex("videos")
      .select("id", "document_id", "published_at")
      .where("locale", "en")
    const videoIdMap = new Map<
      string,
      { draftId: number; publishedId: number }
    >()
    for (const row of videoRows) {
      const v = videoIdMap.get(row.document_id)
      if (v) {
        if (row.published_at) v.publishedId = row.id
        else v.draftId = row.id
      } else {
        videoIdMap.set(row.document_id, {
          draftId: row.published_at ? 0 : row.id,
          publishedId: row.published_at ? row.id : 0,
        })
      }
    }

    const kwRows: Array<{
      id: number
      document_id: string
      published_at: string | null
    }> = await knex("keywords").select("id", "document_id", "published_at")
    const kwIdMap = new Map<string, { draftId: number; publishedId: number }>()
    for (const row of kwRows) {
      const k = kwIdMap.get(row.document_id)
      if (k) {
        if (row.published_at) k.publishedId = row.id
        else k.draftId = row.id
      } else {
        kwIdMap.set(row.document_id, {
          draftId: row.published_at ? 0 : row.id,
          publishedId: row.published_at ? row.id : 0,
        })
      }
    }

    for (const [videoCoreId, kwCoreIds] of videoKeywordLinks) {
      const videoDocId = videoDocMap.get(videoCoreId)
      if (!videoDocId) continue
      const videoIds = videoIdMap.get(videoDocId)
      if (!videoIds) continue

      let kwOrd = 1
      for (const kwCoreId of kwCoreIds) {
        const kwDocId = keywordMap.get(kwCoreId)
        if (!kwDocId) continue
        const kwIds = kwIdMap.get(kwDocId)
        if (!kwIds) continue

        // Draft -> Draft
        if (videoIds.draftId && kwIds.draftId) {
          linkRows.push({
            video_id: videoIds.draftId,
            keyword_id: kwIds.draftId,
            video_ord: kwOrd,
            keyword_ord: 1,
          })
        }
        // Published -> Published
        if (videoIds.publishedId && kwIds.publishedId) {
          linkRows.push({
            video_id: videoIds.publishedId,
            keyword_id: kwIds.publishedId,
            video_ord: kwOrd,
            keyword_ord: 1,
          })
        }
        kwOrd++
      }
    }

    if (linkRows.length > 0) {
      // Delete existing keyword links for all videos being synced
      const allVideoRowIds = [...videoIdMap.values()].flatMap((v) =>
        [v.draftId, v.publishedId].filter(Boolean),
      )
      for (let i = 0; i < allVideoRowIds.length; i += 1000) {
        await knex("videos_keywords_lnk")
          .whereIn("video_id", allVideoRowIds.slice(i, i + 1000))
          .delete()
      }

      // Batch insert
      for (let i = 0; i < linkRows.length; i += 500) {
        await knex("videos_keywords_lnk").insert(linkRows.slice(i, i + 500))
      }
      strapi.log.info(
        `[core-sync] Linked ${linkRows.length} keyword relations across ${videoKeywordLinks.size} videos`,
      )
    }
  }

  // ── Phase 8: Soft-delete (full sync only) ─────────────────────────────
  if (totalFetched > 0 && !isIncremental) {
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

  // ── Phase 9: Link parent->children (manyToMany self-ref) ──────────────
  if (parentChildMap.size > 0) {
    const videoRows: Array<{
      id: number
      document_id: string
      core_id: string
      published_at: string | null
    }> = await knex("videos")
      .select("id", "document_id", "core_id", "published_at")
      .where("locale", "en")

    const coreToDoc = new Map<string, string>()
    const docToIds = new Map<string, { draftId: number; publishedId: number }>()
    for (const row of videoRows) {
      if (row.core_id) coreToDoc.set(row.core_id, row.document_id)
      const v = docToIds.get(row.document_id)
      if (v) {
        if (row.published_at) v.publishedId = row.id
        else v.draftId = row.id
      } else {
        docToIds.set(row.document_id, {
          draftId: row.published_at ? 0 : row.id,
          publishedId: row.published_at ? row.id : 0,
        })
      }
    }

    const childLinkRows: Array<{
      video_id: number
      inv_video_id: number
      video_ord: number
      inv_video_ord: number
    }> = []

    for (const [parentCoreId, childCoreIds] of parentChildMap) {
      const parentDocId = coreToDoc.get(parentCoreId)
      if (!parentDocId) continue
      const parentIds = docToIds.get(parentDocId)
      if (!parentIds) continue

      let ord = 1
      for (const childCoreId of childCoreIds) {
        const childDocId = coreToDoc.get(childCoreId)
        if (!childDocId) continue
        const childIds = docToIds.get(childDocId)
        if (!childIds) continue

        if (parentIds.draftId && childIds.draftId) {
          childLinkRows.push({
            video_id: parentIds.draftId,
            inv_video_id: childIds.draftId,
            video_ord: ord,
            inv_video_ord: 1,
          })
        }
        if (parentIds.publishedId && childIds.publishedId) {
          childLinkRows.push({
            video_id: parentIds.publishedId,
            inv_video_id: childIds.publishedId,
            video_ord: ord,
            inv_video_ord: 1,
          })
        }
        ord++
      }
    }

    if (childLinkRows.length > 0) {
      // Clear existing children links
      const parentRowIds = [...parentChildMap.keys()]
        .map((cid) => coreToDoc.get(cid))
        .filter(Boolean)
        .flatMap((docId) => {
          const ids = docToIds.get(docId!)
          return ids ? [ids.draftId, ids.publishedId].filter(Boolean) : []
        })
      for (let i = 0; i < parentRowIds.length; i += 1000) {
        await knex("videos_children_lnk")
          .whereIn("video_id", parentRowIds.slice(i, i + 1000))
          .delete()
      }

      for (let i = 0; i < childLinkRows.length; i += 500) {
        await knex("videos_children_lnk").insert(
          childLinkRows.slice(i, i + 500),
        )
      }
      strapi.log.info(
        `[core-sync] Linked ${childLinkRows.length} child relations across ${parentChildMap.size} parents`,
      )
    }
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
