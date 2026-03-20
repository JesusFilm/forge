import type { Core } from "@strapi/strapi"
import type { ResultOf } from "@graphql-typed-document-node/core"
import { getGatewayClient } from "./gateway-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  formatError,
  upsertByGatewayId,
  softDeleteUnseen,
  buildGatewayIdMap,
} from "./strapi-helpers"

const DEFAULT_PAGE_SIZE = 100

function getPageSize(): number {
  const env = process.env.GATEWAY_SYNC_VARIANT_PAGE_SIZE
  const parsed = env ? Number(env) : DEFAULT_PAGE_SIZE
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE
}

const VARIANT_COUNT_QUERY = graphql(/* GraphQL */ `
  query SyncVideoVariantsCount {
    videoVariantsCount
  }
`)

const VARIANTS_QUERY = graphql(/* GraphQL */ `
  query SyncVideoVariants($limit: Int!, $offset: Int!) {
    videoVariants(limit: $limit, offset: $offset) {
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

type GatewayVariant = ResultOf<typeof VARIANTS_QUERY>["videoVariants"][number]

export async function syncVideoVariants(
  strapi: Core.Strapi,
): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }
  const pageSize = getPageSize()

  strapi.log.info("[gateway-sync] Starting video variant sync")

  // Get total count from gateway for comparison
  let gatewayTotal = 0
  try {
    const countData = (
      await getGatewayClient().query({ query: VARIANT_COUNT_QUERY })
    ).data
    gatewayTotal = countData.videoVariantsCount
    strapi.log.info(
      `[gateway-sync] Gateway reports ${gatewayTotal} video variants`,
    )
  } catch (error) {
    strapi.log.warn(
      `[gateway-sync] Failed to fetch variant count: ${formatError(error)}`,
    )
  }

  // Pre-load caches to avoid N+1 lookups
  const languageMap = await buildGatewayIdMap(
    strapi,
    "api::language.language",
    "en",
  )
  const videoMap = await buildGatewayIdMap(strapi, "api::video.video", "en")
  const editionMap = new Map<string, string>()
  const muxMap = new Map<string, string>()

  strapi.log.info(
    `[gateway-sync] Variant caches: ${languageMap.size} languages, ${videoMap.size} videos`,
  )

  const seenVariantIds = new Set<string>()
  let offset = 0
  let totalProcessed = 0

  while (true) {
    let variants: GatewayVariant[]
    try {
      const { data } = await getGatewayClient().query({
        query: VARIANTS_QUERY,
        variables: {
          limit: pageSize,
          offset,
        },
      })
      variants = data.videoVariants
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to fetch variant page (offset ${offset}): ${formatError(error)}. Stopping.`,
      )
      break
    }

    if (variants.length === 0) break

    // Pre-pass: upsert editions and mux videos for this batch
    for (const variant of variants) {
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
            `[gateway-sync] Failed to upsert edition ${variant.videoEdition.id}: ${formatError(error)}`,
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
            `[gateway-sync] Failed to upsert mux video ${variant.muxVideo.id}: ${formatError(error)}`,
          )
        }
      }
    }

    // Upsert variants
    for (const variant of variants) {
      seenVariantIds.add(variant.id)

      // Resolve video by gatewayId
      const videoDocId = variant.videoId
        ? videoMap.get(variant.videoId)
        : undefined
      if (!videoDocId) {
        stats.errors++
        continue // skip variants whose parent video hasn't been synced
      }

      try {
        const langDocId = languageMap.get(variant.language.id)
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

        // Build relation fields — use { set: [] } to clear stale relations
        // rather than undefined (which means "don't touch" and preserves
        // broken references that fail Strapi's publish-time validation).
        const relations: Record<string, unknown> = {
          language: langDocId ?? undefined,
          video: { connect: [videoDocId] },
        }
        relations.videoEdition = editionDocId ?? { set: [] }
        relations.muxVideo = muxDocId ?? { set: [] }

        const { action } = await upsertByGatewayId(
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
            ...relations,
            downloads,
          },
        )

        if (action === "created") stats.created++
        else if (action === "updated") stats.updated++
        totalProcessed++
      } catch (error) {
        stats.errors++
        strapi.log.warn(
          `[gateway-sync] Failed to upsert variant ${variant.id}: ${formatError(error)}`,
        )
      }
    }

    strapi.log.info(
      `[gateway-sync] Variants: ${totalProcessed}/${gatewayTotal} (${gatewayTotal ? `${((totalProcessed / gatewayTotal) * 100).toFixed(1)}%` : "?"}) processed so far`,
    )

    if (variants.length < pageSize) break
    offset += pageSize
  }

  // Soft-delete pass
  if (totalProcessed > 0) {
    stats.softDeleted += await softDeleteUnseen(
      strapi,
      "api::video-variant.video-variant",
      seenVariantIds,
    )
  }

  const successRate = gatewayTotal
    ? `${((totalProcessed / gatewayTotal) * 100).toFixed(1)}%`
    : "N/A"

  strapi.log.info(
    `[gateway-sync] Variant sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors (${totalProcessed}/${gatewayTotal} = ${successRate})`,
  )

  return stats
}
