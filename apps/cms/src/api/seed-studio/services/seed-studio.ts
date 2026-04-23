import type { Core } from "@strapi/strapi"
import {
  DEFAULT_LOCALE,
  getExperienceService,
  patchNestedVideoRelations,
} from "../../../bootstrap/seed-utils"
import { sanitizeSlug } from "../../../lib/sanitize-slug"

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

/**
 * Error thrown when `data.slug` fails validation. The controller catches this
 * and returns 400 with a structured body so the seed-studio UI can surface
 * the exact failure reason without parsing free-form strings.
 */
export class InvalidSlugError extends Error {
  readonly reason:
    | "empty"
    | "too-short"
    | "too-long"
    | "invalid-chars"
    | "reserved"
  constructor(reason: InvalidSlugError["reason"]) {
    super(`Invalid slug: ${reason}`)
    this.name = "InvalidSlugError"
    this.reason = reason
  }
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
   * The full delete -> create -> relation-patch sequence runs inside a
   * single `strapi.db.transaction`. If the create or relation-patch fails,
   * the delete is rolled back so the caller retains the prior Experience.
   * Without this, a failed re-publish could leave the slug empty and
   * break the /watch/<slug> route until manual recovery.
   *
   * The slug is sanitized via the central `sanitizeSlug` util before any
   * DB work; rejections throw `InvalidSlugError` so the controller can map
   * them to a 400 response.
   */
  async publishExperience(
    data: PublishExperienceInput,
  ): Promise<PublishExperienceResult> {
    const sanitized = sanitizeSlug(data.slug)
    if (sanitized.ok === false) {
      throw new InvalidSlugError(sanitized.reason)
    }
    const slug = sanitized.slug

    const locale = data.locale ?? DEFAULT_LOCALE
    const experienceService = getExperienceService(strapi)

    return await strapi.db.transaction(async () => {
      // Delete existing experience with the same slug for clean re-creation.
      // A throw later in this transaction rolls the delete back.
      const existing = await experienceService.findFirst({
        locale,
        status: "published",
        filters: { slug },
      })

      if (existing) {
        await experienceService.delete({ documentId: existing.documentId })
        strapi.log.info(
          `[seed-studio] Deleted existing Experience "${slug}" for re-creation.`,
        )
      }

      // Create via Document Service
      const created = await experienceService.create({
        locale,
        status: "published",
        data: {
          slug,
          title: data.title,
          metaDescription: data.metaDescription,
          pathSegment: slug,
          blocks: data.blocks,
          ...(data.platformOrdering != null
            ? { platformOrdering: data.platformOrdering }
            : {}),
        },
      })

      strapi.log.info(
        `[seed-studio] Created Experience "${slug}" (documentId=${created.documentId}).`,
      )

      // Build videoMap from blocks: collect all sections.video components
      // with a sectionKey and numeric video id for relation patching.
      const { map: videoMap, warnings } = collectVideoRelations(data.blocks)
      for (const warning of warnings) {
        strapi.log.warn(`[seed-studio] ${warning}`)
      }

      let relationsPatched = false
      if (videoMap.size > 0) {
        await patchNestedVideoRelations(strapi, videoMap)
        relationsPatched = true
        strapi.log.info(
          `[seed-studio] Patched ${videoMap.size} video relation(s) for "${slug}".`,
        )
      }

      return {
        created: true,
        relationsPatched,
        documentId: created.documentId,
        slug,
      }
    })
  },

  /**
   * Return up to `limit` existing slugs whose text starts with `${prefix}-`.
   * Used by the controller to feed `suggestAlternativeSlugs` when a publish
   * fails due to a slug collision.
   */
  async findSlugsStartingWith(
    prefix: string,
    locale: string = DEFAULT_LOCALE,
    limit: number = 10,
  ): Promise<string[]> {
    const knex: KnexInstance = (strapi.db as KnexInstance).connection
    const rows: { slug: string }[] = await knex("experiences")
      .select("slug")
      .where("locale", locale)
      .andWhere(function (this: KnexInstance) {
        this.where("slug", prefix).orWhere("slug", "ILIKE", `${prefix}-%`)
      })
      .limit(limit)
    return rows.map((r) => r.slug)
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
 * Handles dynamic zones (arrays of blocks) and containers with nested slots.
 * It intentionally does not collect `sections.video-carousel.items`, because
 * `patchNestedVideoRelations` only knows how to patch the `sections.video`
 * component table today.
 *
 * Returns the built map plus a list of warnings (e.g. video components that
 * were skipped because they had no `sectionKey`). The caller decides what to
 * do with warnings — the production service logs them via `strapi.log.warn`
 * while the test suite asserts on them directly.
 *
 * Exported so unit tests can exercise it without spinning up Strapi.
 */
export function collectVideoRelations(
  blocks: Record<string, unknown>[] | undefined | null,
): { map: Map<string, number>; warnings: string[] } {
  const map = new Map<string, number>()
  const warnings: string[] = []
  if (!Array.isArray(blocks)) return { map, warnings }
  walk(blocks, map, warnings)
  return { map, warnings }
}

function walk(
  blocks: Record<string, unknown>[],
  videoMap: Map<string, number>,
  warnings: string[],
): void {
  for (const block of blocks) {
    if (block.__component === "sections.video") {
      if (
        typeof block.sectionKey === "string" &&
        typeof block.video === "number"
      ) {
        videoMap.set(block.sectionKey, block.video)
      } else if (typeof block.video === "number") {
        // We have a numeric video id but no sectionKey to patch against —
        // the nested relation will silently drop. Surface as a warning so
        // the UI can force an author to fill in the key.
        warnings.push(
          `sections.video (video=${block.video}) missing sectionKey; relation will not be patched`,
        )
      }
    }

    // Recurse into container slots
    if (Array.isArray(block.slots)) {
      for (const slot of block.slots as Record<string, unknown>[]) {
        if (Array.isArray(slot.content)) {
          walk(slot.content as Record<string, unknown>[], videoMap, warnings)
        }
      }
    }

    // Recurse into dynamic-zone-like arrays only. Non-component arrays such
    // as `sections.video-carousel.items` are intentionally ignored here until
    // the patch helper knows their table/link layout too.
    for (const [key, value] of Object.entries(block)) {
      if (key === "slots") continue // already handled
      if (!Array.isArray(value) || value.length === 0) continue
      const first = value[0]
      if (typeof first !== "object" || first === null) continue

      if ("__component" in first) {
        walk(value as Record<string, unknown>[], videoMap, warnings)
      }
    }
  }
}
