import type { Core } from "@strapi/strapi"
import type { ResultOf } from "@graphql-typed-document-node/core"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  getPrimaryValue,
  formatError,
  upsertByCoreId,
  softDeleteUnseen,
  buildCoreIdMap,
} from "./strapi-helpers"
import { bulkUpsertByCoreId, type BulkRecord } from "./bulk-upsert"

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

  // Sync BibleBooks via Strapi (small set, only on full sync)
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

  strapi.log.info(
    `[core-sync] Loaded caches: ${languageMap.size} languages, ${bibleBookMap.size} bible books, ${keywordMap.size} keywords`,
  )

  // Dedup origins and editions (small cardinality, upsert via Strapi)
  const originMap = new Map<string, string>()
  const editionMap = new Map<string, string>()

  const seenVideoIds = new Set<string>()
  const seenSubtitleIds = new Set<string>()
  const seenImageIds = new Set<string>()
  const seenStudyQuestionIds = new Set<string>()
  const seenCitationIds = new Set<string>()
  const parentChildMap = new Map<string, string[]>()

  // Collect ALL records for bulk upsert
  const allVideoRecords: BulkRecord[] = []
  const allImageRecords: BulkRecord[] = []
  const allSubtitleRecords: BulkRecord[] = []
  const allStudyQuestionRecords: BulkRecord[] = []
  const allCitationRecords: BulkRecord[] = []
  // Track keyword links per video: videoCoreId → keywordCoreIds
  const videoKeywordLinks = new Map<string, string[]>()

  let offset = 0
  let totalFetched = 0

  // ── Phase 1: Fetch all videos from core API ──────────────────────────
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

    // Upsert origins and editions (small cardinality)
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
      for (const sub of video.subtitles) {
        if (sub.videoEdition && !editionMap.has(sub.videoEdition.id)) {
          try {
            const { documentId } = await upsertByCoreId(
              strapi,
              "api::video-edition.video-edition",
              sub.videoEdition.id,
              { name: sub.videoEdition.name ?? undefined },
            )
            editionMap.set(sub.videoEdition.id, documentId)
          } catch (error) {
            strapi.log.warn(
              `[core-sync] Failed to upsert edition ${sub.videoEdition.id}: ${formatError(error)}`,
            )
          }
        }
      }
    }

    // Collect records
    for (const video of videos) {
      seenVideoIds.add(video.id)

      const childIds = video.children.map((c) => c.id)
      if (childIds.length > 0) parentChildMap.set(video.id, childIds)

      const primaryLangDocId = languageMap.get(video.primaryLanguageId)
      const originDocId = video.origin
        ? originMap.get(video.origin.id)
        : undefined

      allVideoRecords.push({
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
            // Placeholder — resolved after video bulk upsert
            _videoCoreId: video.id,
          } as Record<string, string | undefined>,
        })
      }

      // Study questions
      for (const sq of video.studyQuestions) {
        if (!sq.id) continue
        seenStudyQuestionIds.add(sq.id)
        allStudyQuestionRecords.push({
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
        allCitationRecords.push({
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
        allSubtitleRecords.push({
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

    totalFetched += videos.length
    progress.increment(videos.length)
    const pct = coreTotal
      ? `${((totalFetched / coreTotal) * 100).toFixed(1)}%`
      : "?"
    strapi.log.info(
      `[core-sync] Videos fetched: ${totalFetched}/${coreTotal} (${pct})`,
    )

    if (videos.length < pageSize) break
    offset += pageSize
  }

  // ── Phase 2: Bulk upsert videos ───────────────────────────────────────
  strapi.log.info(`[core-sync] Bulk upserting ${allVideoRecords.length} videos`)
  const videoStats = await bulkUpsertByCoreId(
    strapi,
    {
      tableName: "videos",
      locale: "en",
      linkConfigs: [
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
      ],
    },
    allVideoRecords,
  )
  stats.created = videoStats.created
  stats.updated = videoStats.updated
  stats.errors = videoStats.errors
  strapi.log.info(
    `[core-sync] Videos: ${videoStats.created} created, ${videoStats.updated} updated, ${videoStats.errors} errors`,
  )

  // Build video coreId → documentId map for sub-entity linking
  const videoDocMap = await buildCoreIdMap(strapi, "api::video.video", "en")

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

  // ── Phase 3: Bulk upsert images ───────────────────────────────────────
  resolveVideoLinks(allImageRecords, "video_images_video_lnk")
  if (allImageRecords.length > 0) {
    strapi.log.info(
      `[core-sync] Bulk upserting ${allImageRecords.length} video images`,
    )
    const imgStats = await bulkUpsertByCoreId(
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
      `[core-sync] Video images: ${imgStats.created} created, ${imgStats.updated} updated`,
    )
  }

  // ── Phase 4: Bulk upsert study questions ──────────────────────────────
  resolveVideoLinks(allStudyQuestionRecords, "video_study_questions_video_lnk")
  if (allStudyQuestionRecords.length > 0) {
    strapi.log.info(
      `[core-sync] Bulk upserting ${allStudyQuestionRecords.length} study questions`,
    )
    const sqStats = await bulkUpsertByCoreId(
      strapi,
      {
        tableName: "video_study_questions",
        locale: "en",
        linkConfigs: [
          {
            linkTable: "video_study_questions_video_lnk",
            sourceColumn: "video_study_question_id",
            targetTable: "videos",
            targetColumn: "video_id",
            targetLocale: "en",
            orderColumn: "video_study_question_ord",
          },
        ],
      },
      allStudyQuestionRecords,
    )
    strapi.log.info(
      `[core-sync] Study questions: ${sqStats.created} created, ${sqStats.updated} updated`,
    )
  }

  // ── Phase 5: Bulk upsert bible citations ──────────────────────────────
  resolveVideoLinks(allCitationRecords, "bible_citations_video_lnk")
  if (allCitationRecords.length > 0) {
    strapi.log.info(
      `[core-sync] Bulk upserting ${allCitationRecords.length} bible citations`,
    )
    const bcStats = await bulkUpsertByCoreId(
      strapi,
      {
        tableName: "bible_citations",
        locale: "",
        linkConfigs: [
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
        ],
      },
      allCitationRecords,
    )
    strapi.log.info(
      `[core-sync] Bible citations: ${bcStats.created} created, ${bcStats.updated} updated`,
    )
  }

  // ── Phase 6: Bulk upsert subtitles ────────────────────────────────────
  resolveVideoLinks(allSubtitleRecords, "video_subtitles_video_lnk")
  if (allSubtitleRecords.length > 0) {
    strapi.log.info(
      `[core-sync] Bulk upserting ${allSubtitleRecords.length} subtitles`,
    )
    const subStats = await bulkUpsertByCoreId(
      strapi,
      {
        tableName: "video_subtitles",
        locale: "",
        linkConfigs: [
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
        ],
      },
      allSubtitleRecords,
    )
    strapi.log.info(
      `[core-sync] Subtitles: ${subStats.created} created, ${subStats.updated} updated`,
    )
  }

  // ── Phase 7: Link keywords (manyToMany via raw SQL) ───────────────────
  if (videoKeywordLinks.size > 0) {
    const knex = strapi.db.connection
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

        // Draft → Draft
        if (videoIds.draftId && kwIds.draftId) {
          linkRows.push({
            video_id: videoIds.draftId,
            keyword_id: kwIds.draftId,
            video_ord: kwOrd,
            keyword_ord: 1,
          })
        }
        // Published → Published
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

  // ── Phase 9: Link parent→children (manyToMany self-ref) ──────────────
  if (parentChildMap.size > 0) {
    const knex = strapi.db.connection
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
