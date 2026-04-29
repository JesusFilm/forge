// Resolve cms numeric video ids → admin Video cuids via the shared
// `core_id` axis.
//
// cms components reference videos by their integer PK (e.g.
// `videoHero.video → videos.id`). Admin has one Video row per
// `core_id` (Strapi → Core → admin all carry the same coreId).
// The transformer needs admin's cuid to populate
// `BlockSchema.videoId`.
//
// The dump service builds a single resolver per locale's batch of
// cms video ids, so transformers receive a closure over the
// pre-resolved map and never issue per-block queries.
//
// Misses are routine during the R3→R8 window (admin's Video corpus
// is still being filled by Core sync). The resolver returns a
// `null` adminVideoId for those; the transformer drops the
// reference rather than failing the locale (per the plan's Key
// Decision §11).

import type { PrismaClient } from "@prisma/client"
import type { Pool } from "pg"

export type CmsVideoIdResolution = {
  /** Cms `core_id` for the resolved cms video, or null if cms has no coreId. */
  coreId: string | null
  /** Admin Video row's cuid, or null if no admin Video has the matching coreId. */
  adminVideoId: string | null
}

export type CmsVideoIdResolver = {
  /**
   * Pre-batched resolver function. The dump service collects every
   * cms video id referenced anywhere in a locale's components, calls
   * `resolve()` once, then hands the returned map to per-component
   * transformers.
   */
  resolve(
    cmsVideoIds: ReadonlySet<number>,
  ): Promise<Map<number, CmsVideoIdResolution>>
}

export function createCmsVideoIdResolver(
  cmsPool: Pool,
  prisma: PrismaClient,
): CmsVideoIdResolver {
  return {
    async resolve(cmsVideoIds) {
      if (cmsVideoIds.size === 0) return new Map()

      const ids = Array.from(cmsVideoIds)

      // Step 1: cms video id → core_id. Strapi's videos table may
      // have multiple rows per (document_id, locale) for draft +
      // published; we take the row's coreId regardless of state
      // since coreId is per-document, not per-row-state.
      const cmsRows = await cmsPool.query<{
        id: number
        core_id: string | null
      }>(`SELECT id, core_id FROM videos WHERE id = ANY($1::int[])`, [ids])
      const coreIdByCmsId = new Map<number, string | null>()
      for (const id of ids) coreIdByCmsId.set(id, null)
      for (const row of cmsRows.rows) {
        coreIdByCmsId.set(row.id, row.core_id)
      }

      // Step 2: admin Video lookup by coreId. Filter out nulls
      // (some cms videos may lack a coreId — they cannot resolve
      // to admin regardless).
      const knownCoreIds = Array.from(coreIdByCmsId.values()).filter(
        (v): v is string => v !== null,
      )
      const adminByCoreId = new Map<string, string>()
      if (knownCoreIds.length > 0) {
        const adminRows = await prisma.video.findMany({
          where: { coreId: { in: knownCoreIds } },
          select: { id: true, coreId: true },
        })
        for (const row of adminRows) {
          adminByCoreId.set(row.coreId, row.id)
        }
      }

      // Step 3: assemble the resolution map. Every requested cms id
      // gets an entry; misses are explicit `null`s rather than
      // omissions so callers can distinguish "we asked, no match"
      // from "we never asked".
      const out = new Map<number, CmsVideoIdResolution>()
      for (const id of ids) {
        const coreId = coreIdByCmsId.get(id) ?? null
        const adminVideoId =
          coreId !== null ? (adminByCoreId.get(coreId) ?? null) : null
        out.set(id, { coreId, adminVideoId })
      }
      return out
    },
  }
}

/**
 * Convenience: collapse a `Map<number, CmsVideoIdResolution>` into
 * a `(cmsVideoId) => string | undefined` lookup that block
 * transformers can call directly. `undefined` (not `null`) is
 * returned because admin's Zod BlockSchema treats `videoId` as
 * `.optional()` — `undefined` is the idiomatic "not present" value.
 */
export function adminVideoIdLookup(
  resolutions: Map<number, CmsVideoIdResolution>,
): (cmsVideoId: number | null) => string | undefined {
  return (cmsVideoId) => {
    if (cmsVideoId === null) return undefined
    return resolutions.get(cmsVideoId)?.adminVideoId ?? undefined
  }
}
