import type { Core } from "@strapi/strapi"
import type { ResultOf } from "@graphql-typed-document-node/core"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  formatError,
  upsertByCoreId,
  softDeleteUnseen,
  buildCoreIdMap,
} from "./strapi-helpers"
import { bulkUpsertByCoreId } from "./bulk-upsert"

const DEFAULT_PAGE_SIZE = 100

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

  const input: { updatedAt?: { gte: string } } | undefined = since
    ? { updatedAt: { gte: since } }
    : undefined

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

  // Collect editions and mux videos for dedup + upsert (small cardinality)
  const editionMap = new Map<string, string>()
  const muxMap = new Map<string, string>()

  const seenVariantIds = new Set<string>()
  const seenDownloadIds = new Set<string>()

  // Collect all variant and download records for bulk upsert
  const allVariantRecords: Array<{
    coreId: string
    data: Record<string, unknown>
    links: Record<string, string | undefined>
  }> = []
  const allDownloadRecords: Array<{
    coreId: string
    data: Record<string, unknown>
    links: Record<string, string | undefined>
  }> = []
  let offset = 0
  let totalFetched = 0

  while (true) {
    let variants: CoreVariant[]
    try {
      const { data } = await getCoreClient().query({
        query: VARIANTS_QUERY,
        variables: { limit: pageSize, offset, input },
      })
      variants = data.videoVariants
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Failed to fetch variant page (offset ${offset}): ${formatError(error)}. Stopping.`,
      )
      break
    }

    if (variants.length === 0) break

    // Pre-pass: upsert editions and mux videos (small cardinality, keep via Strapi)
    for (const variant of variants) {
      if (variant.videoEdition && !editionMap.has(variant.videoEdition.id)) {
        try {
          const { documentId } = await upsertByCoreId(
            strapi,
            "api::video-edition.video-edition",
            variant.videoEdition.id,
            { name: variant.videoEdition.name ?? undefined },
          )
          editionMap.set(variant.videoEdition.id, documentId)
        } catch (error) {
          strapi.log.warn(
            `[core-sync] Failed to upsert edition ${variant.videoEdition.id}: ${formatError(error)}`,
          )
        }
      }
      if (variant.muxVideo && !muxMap.has(variant.muxVideo.id)) {
        try {
          const { documentId } = await upsertByCoreId(
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
            `[core-sync] Failed to upsert mux video ${variant.muxVideo.id}: ${formatError(error)}`,
          )
        }
      }
    }

    // Collect variant records for bulk upsert
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

      allVariantRecords.push({
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

      // Collect downloads (we'll resolve variant documentIds after bulk upsert)
      for (const dl of variant.downloads) {
        allDownloadRecords.push({
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
            // Placeholder — will be resolved after variant bulk upsert
            _variantCoreId: variant.id,
          } as Record<string, string | undefined>,
        })
      }
    }

    totalFetched += variants.length
    const pct = coreTotal
      ? `${((totalFetched / coreTotal) * 100).toFixed(1)}%`
      : "?"
    strapi.log.info(
      `[core-sync] Variants fetched: ${totalFetched}/${coreTotal} (${pct})`,
    )

    if (variants.length < pageSize) break
    offset += pageSize
  }

  // Bulk upsert all variants
  if (allVariantRecords.length > 0) {
    strapi.log.info(
      `[core-sync] Bulk upserting ${allVariantRecords.length} video variants`,
    )
    const variantStats = await bulkUpsertByCoreId(
      strapi,
      {
        tableName: "video_variants",
        locale: "",
        linkConfigs: [
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
        ],
      },
      allVariantRecords,
      progress,
    )

    stats.created = variantStats.created
    stats.updated = variantStats.updated
    stats.errors += variantStats.errors

    strapi.log.info(
      `[core-sync] Video variants: ${variantStats.created} created, ${variantStats.updated} updated, ${variantStats.errors} errors`,
    )
  }

  // Now resolve variant documentIds for downloads
  if (allDownloadRecords.length > 0) {
    const variantDocMap = await buildCoreIdMap(
      strapi,
      "api::video-variant.video-variant",
    )

    // Replace placeholder _variantCoreId with actual documentId
    for (const dl of allDownloadRecords) {
      const variantCoreId = (dl.links as Record<string, string>)._variantCoreId
      delete dl.links._variantCoreId
      dl.links.video_variant_downloads_video_variant_lnk =
        variantDocMap.get(variantCoreId)
    }

    strapi.log.info(
      `[core-sync] Bulk upserting ${allDownloadRecords.length} variant downloads`,
    )
    const dlStats = await bulkUpsertByCoreId(
      strapi,
      {
        tableName: "video_variant_downloads",
        locale: "",
        linkConfigs: [
          {
            linkTable: "video_variant_downloads_video_variant_lnk",
            sourceColumn: "video_variant_download_id",
            targetTable: "video_variants",
            targetColumn: "video_variant_id",
            targetLocale: "",
            orderColumn: "video_variant_download_ord",
          },
        ],
      },
      allDownloadRecords,
    )
    strapi.log.info(
      `[core-sync] Variant downloads: ${dlStats.created} created, ${dlStats.updated} updated, ${dlStats.errors} errors`,
    )
  }

  // Soft-delete pass (full sync only)
  if (allVariantRecords.length > 0 && !isIncremental) {
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
