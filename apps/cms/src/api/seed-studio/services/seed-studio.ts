import type { Core } from "@strapi/strapi"
import {
  DEFAULT_LOCALE,
  getExperienceService,
  patchNestedVideoRelations,
} from "../../../bootstrap/seed-utils"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

type VideoSearchResult = {
  id: number
  documentId: string
  title: string
  slug: string
  description: string | null
  streamingUrl: string | null
  thumbnailUrl: string | null
}

type PublishExperienceInput = {
  title: string
  slug: string
  metaDescription?: string
  blocks: Record<string, unknown>[]
  platformOrdering?: unknown
  locale?: string
}

type PublishExperienceResult = {
  created: boolean
  relationsPatched: boolean
  documentId: string
  slug: string
}

type VideoCatalogStats = {
  totalVideos: number
  labels: string[]
  locales: string[]
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Search published videos by title/description/slug with ILIKE matching.
   * Optionally filter by label tags. Returns max 20 results.
   */
  async searchVideos(
    query: string,
    tags?: string[],
    locale: string = DEFAULT_LOCALE,
  ): Promise<VideoSearchResult[]> {
    const knex: KnexInstance = (strapi.db as KnexInstance).connection
    const pattern = `%${query}%`

    // streaming URL lives in video_variants.hls, thumbnail in video_images.url
    let builder = knex("videos as v")
      .distinctOn("v.id")
      .select(
        "v.id",
        "v.document_id as documentId",
        "v.title",
        "v.slug",
        "v.description",
        "vv.hls as streamingUrl",
        knex.raw(
          'COALESCE(vi.video_still, vi.url, vi.thumbnail) as "thumbnailUrl"',
        ),
      )
      .leftJoin("video_variants_video_lnk as vvl", "vvl.video_id", "v.id")
      .leftJoin("video_variants as vv", "vv.id", "vvl.video_variant_id")
      .leftJoin("video_images_video_lnk as vil", "vil.video_id", "v.id")
      .leftJoin("video_images as vi", "vi.id", "vil.video_image_id")
      .where("v.locale", locale)
      .whereNotNull("v.published_at")
      .andWhere(function (this: KnexInstance) {
        this.where("v.title", "ILIKE", pattern)
          .orWhere("v.description", "ILIKE", pattern)
          .orWhere("v.slug", "ILIKE", pattern)
      })

    if (tags && tags.length > 0) {
      builder = builder.whereIn("v.label", tags)
    }

    const rows: VideoSearchResult[] = await builder.orderBy("v.id").limit(20)

    // Filter out results without a streaming URL
    return rows.filter((r) => r.streamingUrl != null)
  },

  /**
   * Create (or re-create) an Experience with blocks, then patch nested
   * video relations that Strapi v5 Document Service silently drops.
   *
   * Follows the same delete-then-create pattern as seed-easter.
   */
  async publishExperience(
    data: PublishExperienceInput,
  ): Promise<PublishExperienceResult> {
    const locale = data.locale ?? DEFAULT_LOCALE
    const experienceService = getExperienceService(strapi)

    // Delete existing experience with the same slug for clean re-creation
    const existing = await experienceService.findFirst({
      locale,
      status: "published",
      filters: { slug: data.slug },
    })

    if (existing) {
      await experienceService.delete({ documentId: existing.documentId })
      strapi.log.info(
        `[seed-studio] Deleted existing Experience "${data.slug}" for re-creation.`,
      )
    }

    // Create via Document Service
    const created = await experienceService.create({
      locale,
      status: "published",
      data: {
        slug: data.slug,
        title: data.title,
        metaDescription: data.metaDescription,
        pathSegment: data.slug,
        blocks: data.blocks,
        ...(data.platformOrdering != null
          ? { platformOrdering: data.platformOrdering }
          : {}),
      },
    })

    strapi.log.info(
      `[seed-studio] Created Experience "${data.slug}" (documentId=${created.documentId}).`,
    )

    // Build videoMap from blocks: collect all sections.video components
    // with a sectionKey and numeric video id for relation patching.
    const videoMap = new Map<string, number>()
    collectVideoRelations(data.blocks, videoMap)

    let relationsPatched = false
    if (videoMap.size > 0) {
      await patchNestedVideoRelations(strapi, videoMap)
      relationsPatched = true
      strapi.log.info(
        `[seed-studio] Patched ${videoMap.size} video relation(s) for "${data.slug}".`,
      )
    }

    return {
      created: true,
      relationsPatched,
      documentId: created.documentId,
      slug: data.slug,
    }
  },

  /**
   * Return catalog overview: total published videos, distinct labels, and locales.
   */
  async getVideoCatalogStats(): Promise<VideoCatalogStats> {
    const knex: KnexInstance = (strapi.db as KnexInstance).connection

    const [countResult]: [{ count: string }] = await knex("videos")
      .whereNotNull("published_at")
      .count("id as count")

    const labelRows: { label: string }[] = await knex("videos")
      .distinct("label")
      .whereNotNull("published_at")
      .whereNotNull("label")
      .where("label", "!=", "")
      .orderBy("label")

    const localeRows: { locale: string }[] = await knex("videos")
      .distinct("locale")
      .whereNotNull("published_at")
      .whereNotNull("locale")
      .orderBy("locale")

    return {
      totalVideos: parseInt(countResult.count, 10),
      labels: labelRows.map((r) => r.label),
      locales: localeRows.map((r) => r.locale),
    }
  },
})

/**
 * Recursively walk blocks to find all `sections.video` components that have
 * both a `sectionKey` and a numeric `video` id, building the map needed for
 * patchNestedVideoRelations.
 *
 * Handles dynamic zones (arrays of blocks), containers with nested slots,
 * and any other structure that may contain video components.
 */
function collectVideoRelations(
  blocks: Record<string, unknown>[],
  videoMap: Map<string, number>,
): void {
  for (const block of blocks) {
    if (
      block.__component === "sections.video" &&
      typeof block.sectionKey === "string" &&
      typeof block.video === "number"
    ) {
      videoMap.set(block.sectionKey, block.video)
    }

    // Recurse into container slots
    if (Array.isArray(block.slots)) {
      for (const slot of block.slots as Record<string, unknown>[]) {
        if (Array.isArray(slot.content)) {
          collectVideoRelations(
            slot.content as Record<string, unknown>[],
            videoMap,
          )
        }
      }
    }

    // Recurse into any array-valued property that looks like nested blocks
    for (const value of Object.values(block)) {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === "object" &&
        value[0] !== null &&
        "__component" in value[0]
      ) {
        collectVideoRelations(value as Record<string, unknown>[], videoMap)
      }
    }
  }
}
