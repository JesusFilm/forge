import type { Core } from "@strapi/strapi"
import type { ResultOf } from "@graphql-typed-document-node/core"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  formatError,
  softDeleteUnseen,
  buildCoreIdMap,
} from "./strapi-helpers"
import { bulkUpsertByCoreId } from "./bulk-upsert"

const DEFAULT_PAGE_SIZE = 500

function getPageSize(): number {
  const env = process.env.CORE_SYNC_VARIANT_PAGE_SIZE
  const parsed = env ? Number(env) : DEFAULT_PAGE_SIZE
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE
}

const VARIANT_COUNT_QUERY = graphql(/* GraphQL */ `
  query SyncVideoVariantsCount($input: VideoVariantFilter) {
    videoVariantsCount(input: $input)
  }
`)

const VARIANTS_QUERY = graphql(/* GraphQL */ `
  query SyncVideoVariants(
    $limit: Int!
    $offset: Int!
    $input: VideoVariantFilter
  ) {
    videoVariants(limit: $limit, offset: $offset, input: $input) {
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
      videoId
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
`)

type CoreVariant = ResultOf<typeof VARIANTS_QUERY>["videoVariants"][number]

export async function syncVideoVariants(
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
  strapi.log.info(`[core-sync] Starting video variant sync (${mode})`)

  // Always pass input (even as empty object) so Apollo doesn't strip
  // the $input variable from the query text
  const input: { updatedAt?: { gte: string } } = since
    ? { updatedAt: { gte: since } }
    : {}

  let coreTotal = 0
  try {
    const countData = (
      await getCoreClient().query({
        query: VARIANT_COUNT_QUERY,
        variables: { input },
      })
    ).data
    coreTotal = countData.videoVariantsCount
    if (coreTotal > 0) progress.setTotal(coreTotal)
    strapi.log.info(
      `[core-sync] Core API reports ${coreTotal} ${isIncremental ? "updated " : ""}video variants`,
    )
  } catch (error) {
    strapi.log.warn(
      `[core-sync] Failed to fetch variant count: ${formatError(error)}`,
    )
  }

  // Pre-load caches (coreId → documentId)
  const languageMap = await buildCoreIdMap(
    strapi,
    "api::language.language",
    "en",
  )
  const videoMap = await buildCoreIdMap(strapi, "api::video.video", "en")

  strapi.log.info(
    `[core-sync] Variant caches: ${languageMap.size} languages, ${videoMap.size} videos`,
  )

  // Dedup caches for small-cardinality entities (upserted via Strapi)
  const editionMap = new Map<string, string>()
  const muxMap = new Map<string, string>()

  const seenVariantIds = new Set<string>()
  const seenDownloadIds = new Set<string>()

  // Variant link config (reused each page)
  const variantLinkConfigs = [
    {
      linkTable: "video_variants_language_lnk",
      sourceColumn: "video_variant_id",
      targetTable: "languages",
      targetColumn: "language_id",
      targetLocale: "en",
      orderColumn: "video_variant_ord",
    },
    {
      linkTable: "video_variants_video_edition_lnk",
      sourceColumn: "video_variant_id",
      targetTable: "video_editions",
      targetColumn: "video_edition_id",
      targetLocale: "",
      orderColumn: "video_variant_ord",
    },
    {
      linkTable: "video_variants_mux_video_lnk",
      sourceColumn: "video_variant_id",
      targetTable: "mux_videos",
      targetColumn: "mux_video_id",
      targetLocale: "",
      orderColumn: "video_variant_ord",
    },
    {
      linkTable: "video_variants_video_lnk",
      sourceColumn: "video_variant_id",
      targetTable: "videos",
      targetColumn: "video_id",
      targetLocale: "en",
      orderColumn: "video_variant_ord",
    },
  ]

  const downloadLinkConfigs = [
    {
      linkTable: "video_variant_downloads_video_variant_lnk",
      sourceColumn: "video_variant_download_id",
      targetTable: "video_variants",
      targetColumn: "video_variant_id",
      targetLocale: "",
      orderColumn: "video_variant_download_ord",
    },
  ]

  // Running map of variant coreId → documentId, accumulated across pages
  const variantDocMap = new Map<string, string>()

  let offset = 0
  let totalFetched = 0

  // Prefetch: kick off the first page fetch
  let pendingFetch: Promise<CoreVariant[]> | null = null

  function fetchPage(pageOffset: number): Promise<CoreVariant[]> {
    const fetchStart = Date.now()
    return getCoreClient()
      .query({
        query: VARIANTS_QUERY,
        variables: { limit: pageSize, offset: pageOffset, input },
      })
      .then(({ data }) => {
        const fetchMs = Date.now() - fetchStart
        strapi.log.info(
          `[core-sync] [timing] fetch page offset=${pageOffset}: ${fetchMs}ms (${data.videoVariants.length} records)`,
        )
        return data.videoVariants
      })
  }

  pendingFetch = fetchPage(offset)

  while (true) {
    const pageStart = Date.now()
    let variants: CoreVariant[]
    try {
      variants = await pendingFetch!
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to fetch variant page (offset ${offset}): ${formatError(error)}. Stopping.`,
      )
      break
    }

    if (variants.length === 0) break

    // Prefetch next page while we process this one
    const hasMore = variants.length === pageSize
    if (hasMore) {
      pendingFetch = fetchPage(offset + pageSize)
    }

    // Pre-pass: bulk upsert editions and mux videos (deduped across pages)
    const editionMuxStart = Date.now()
    const pageEditionRecords: Array<{
      coreId: string
      data: Record<string, unknown>
    }> = []
    const pageMuxRecords: Array<{
      coreId: string
      data: Record<string, unknown>
    }> = []

    for (const variant of variants) {
      if (variant.videoEdition && !editionMap.has(variant.videoEdition.id)) {
        pageEditionRecords.push({
          coreId: variant.videoEdition.id,
          data: { name: variant.videoEdition.name ?? null },
        })
        editionMap.set(variant.videoEdition.id, "") // placeholder — resolved after bulk upsert
      }
      if (variant.muxVideo && !muxMap.has(variant.muxVideo.id)) {
        pageMuxRecords.push({
          coreId: variant.muxVideo.id,
          data: {
            asset_id: variant.muxVideo.assetId ?? null,
            playback_id: variant.muxVideo.playbackId ?? null,
          },
        })
        muxMap.set(variant.muxVideo.id, "") // placeholder
      }
    }

    if (pageEditionRecords.length > 0) {
      await bulkUpsertByCoreId(
        strapi,
        { tableName: "video_editions", locale: "", linkConfigs: [] },
        pageEditionRecords,
      )
      // Resolve documentIds for new editions
      const knex = strapi.db.connection
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

    if (pageMuxRecords.length > 0) {
      await bulkUpsertByCoreId(
        strapi,
        { tableName: "mux_videos", locale: "", linkConfigs: [] },
        pageMuxRecords,
      )
      // Resolve documentIds for new mux videos
      const knex = strapi.db.connection
      const muxCoreIds = pageMuxRecords.map((r) => r.coreId)
      const muxRows: Array<{ core_id: string; document_id: string }> =
        await knex("mux_videos")
          .select("core_id", "document_id")
          .whereIn("core_id", muxCoreIds)
          .where("locale", "")
          .groupBy("core_id", "document_id")
      for (const row of muxRows) {
        muxMap.set(row.core_id, row.document_id)
      }
    }

    const editionMuxMs = Date.now() - editionMuxStart
    if (editionMuxMs > 50) {
      strapi.log.info(
        `[core-sync] [timing] edition/mux bulk upserts: ${editionMuxMs}ms (${pageEditionRecords.length} editions, ${pageMuxRecords.length} mux)`,
      )
    }

    // Build variant and download records for this page
    const pageVariantRecords: Array<{
      coreId: string
      data: Record<string, unknown>
      links: Record<string, string | undefined>
    }> = []
    const pageDownloadRecords: Array<{
      coreId: string
      data: Record<string, unknown>
      links: Record<string, string | undefined>
    }> = []

    for (const variant of variants) {
      seenVariantIds.add(variant.id)
      for (const dl of variant.downloads) seenDownloadIds.add(dl.id)

      const videoDocId = variant.videoId
        ? videoMap.get(variant.videoId)
        : undefined
      if (!videoDocId) {
        stats.errors++
        continue
      }

      const langDocId = languageMap.get(variant.language.id)
      const editionDocId = variant.videoEdition
        ? editionMap.get(variant.videoEdition.id)
        : undefined
      const muxDocId = variant.muxVideo
        ? muxMap.get(variant.muxVideo.id)
        : undefined

      pageVariantRecords.push({
        coreId: variant.id,
        data: {
          slug: variant.slug ?? null,
          duration: variant.duration,
          length_in_milliseconds: variant.lengthInMilliseconds,
          hls: variant.hls ?? null,
          dash: variant.dash ?? null,
          share: variant.share ?? null,
          downloadable: variant.downloadable,
          published: variant.published,
          brightcove_id: variant.brightcoveId ?? null,
        },
        links: {
          video_variants_language_lnk: langDocId,
          video_variants_video_edition_lnk: editionDocId,
          video_variants_mux_video_lnk: muxDocId,
          video_variants_video_lnk: videoDocId,
        },
      })

      for (const dl of variant.downloads) {
        pageDownloadRecords.push({
          coreId: dl.id,
          data: {
            quality: dl.quality,
            size: dl.size,
            height: dl.height,
            width: dl.width,
            bitrate: dl.bitrate,
            url: dl.url,
          },
          links: {
            _variantCoreId: variant.id,
          } as Record<string, string | undefined>,
        })
      }
    }

    // Bulk upsert variants for this page
    const variantUpsertStart = Date.now()
    if (pageVariantRecords.length > 0) {
      const variantStats = await bulkUpsertByCoreId(
        strapi,
        {
          tableName: "video_variants",
          locale: "",
          linkConfigs: variantLinkConfigs,
        },
        pageVariantRecords,
        progress,
      )
      stats.created += variantStats.created
      stats.updated += variantStats.updated
      stats.errors += variantStats.errors
    }

    const variantUpsertMs = Date.now() - variantUpsertStart

    // Bulk upsert downloads for this page (resolve variant links using running map)
    const downloadUpsertStart = Date.now()
    if (pageDownloadRecords.length > 0) {
      // Query only the variants we just upserted to get their documentIds
      const knex = strapi.db.connection
      const pageCoreIds = pageVariantRecords.map((r) => r.coreId)
      const variantRows: Array<{ core_id: string; document_id: string }> =
        await knex("video_variants")
          .select("core_id", "document_id")
          .whereIn("core_id", pageCoreIds)
          .where("locale", "")
          .groupBy("core_id", "document_id")
      for (const row of variantRows) {
        variantDocMap.set(row.core_id, row.document_id)
      }

      for (const dl of pageDownloadRecords) {
        const variantCoreId = (dl.links as Record<string, string>)
          ._variantCoreId
        delete dl.links._variantCoreId
        dl.links.video_variant_downloads_video_variant_lnk =
          variantDocMap.get(variantCoreId)
      }
      const dlStats = await bulkUpsertByCoreId(
        strapi,
        {
          tableName: "video_variant_downloads",
          locale: "",
          linkConfigs: downloadLinkConfigs,
        },
        pageDownloadRecords,
      )
      stats.errors += dlStats.errors
    }

    const downloadUpsertMs = Date.now() - downloadUpsertStart
    const pageMs = Date.now() - pageStart

    totalFetched += variants.length
    const pct = coreTotal
      ? `${((totalFetched / coreTotal) * 100).toFixed(1)}%`
      : "?"
    strapi.log.info(
      `[core-sync] Variants: ${totalFetched}/${coreTotal} (${pct}) — page: ${pageVariantRecords.length}v/${pageDownloadRecords.length}dl — timing: page=${pageMs}ms variant_upsert=${variantUpsertMs}ms download_upsert=${downloadUpsertMs}ms`,
    )

    if (variants.length < pageSize) break
    offset += pageSize
  }

  // Soft-delete pass (full sync only)
  if (seenVariantIds.size > 0 && !isIncremental) {
    stats.softDeleted += await softDeleteUnseen(
      strapi,
      "api::video-variant.video-variant",
      seenVariantIds,
    )
    stats.softDeleted += await softDeleteUnseen(
      strapi,
      "api::video-variant-download.video-variant-download",
      seenDownloadIds,
    )
  }

  const successRate = coreTotal
    ? `${(((stats.created + stats.updated) / coreTotal) * 100).toFixed(1)}%`
    : "N/A"

  strapi.log.info(
    `[core-sync] Variant sync complete (${mode}): ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors (${successRate})`,
  )

  return stats
}
