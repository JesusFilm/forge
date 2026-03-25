import type { Core } from "@strapi/strapi"

/**
 * Strapi v5 generates content-type types at boot time.
 * Our new content types (language, country, etc.) aren't in the generated
 * type registry yet, so we use a loosely-typed document service wrapper.
 *
 * This mirrors the pattern in src/bootstrap/seed-easter.ts which uses
 * `as unknown as DocumentService<...>` casts for the same reason.
 */

type AnyDocument = Record<string, unknown> & {
  documentId: string
  id?: unknown
}

type DocumentService = {
  findFirst: (params: Record<string, unknown>) => Promise<AnyDocument | null>
  findMany: (params: Record<string, unknown>) => Promise<AnyDocument[]>
  create: (params: Record<string, unknown>) => Promise<AnyDocument>
  update: (params: Record<string, unknown>) => Promise<AnyDocument>
  delete: (params: Record<string, unknown>) => Promise<unknown>
  publish: (params: Record<string, unknown>) => Promise<unknown>
  unpublish: (params: Record<string, unknown>) => Promise<unknown>
}

export type GatewayTranslation = {
  id?: string
  value: string
  primary: boolean
  language: { id: string }
}

export type SyncStats = {
  created: number
  updated: number
  softDeleted: number
  errors: number
}

export function docs(strapi: Core.Strapi, uid: string): DocumentService {
  return strapi.documents(uid as never) as unknown as DocumentService
}

export function getPrimaryValue(translations: GatewayTranslation[]): string {
  const primary = translations.find((t) => t.primary)
  return primary?.value ?? translations[0]?.value ?? ""
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    if (error.stack && process.env.NODE_ENV !== "production") {
      return error.stack.split("\n").slice(0, 5).join(" | ")
    }
    return error.message
  }
  return String(error)
}

/** Use for optional manyToOne relations — clears stale refs instead of preserving them. */
export function clearableRelation(
  docId: string | undefined,
): string | { set: [] } {
  return docId ?? { set: [] }
}

export async function findByGatewayId(
  strapi: Core.Strapi,
  uid: string,
  gatewayId: string,
  locale?: string,
): Promise<AnyDocument | null> {
  const params: Record<string, unknown> = {
    filters: { gatewayId: { $eq: gatewayId } },
  }
  if (locale) params.locale = locale
  return docs(strapi, uid).findFirst(params)
}

export async function upsertByGatewayId(
  strapi: Core.Strapi,
  uid: string,
  gatewayId: string,
  data: Record<string, unknown>,
  options?: { locale?: string },
): Promise<{ documentId: string; action: "created" | "updated" | "skipped" }> {
  const existing = await findByGatewayId(
    strapi,
    uid,
    gatewayId,
    options?.locale,
  )

  if (existing) {
    if (existing.source === "manager") {
      return { documentId: existing.documentId, action: "skipped" }
    }
    await docs(strapi, uid).update({
      documentId: existing.documentId,
      data: { ...data, gatewayId, source: "gateway" },
      ...(options?.locale && { locale: options.locale }),
      status: "published",
    })
    return { documentId: existing.documentId, action: "updated" }
  }

  // Create as draft only. Strapi v5 entity validator rejects the internal
  // publish step of `create({status: "published"})` when manyToOne
  // relation targets use documentId strings. The post-sync publishDrafts()
  // call promotes all drafts after every phase completes.
  const draft = await docs(strapi, uid).create({
    data: { ...data, gatewayId, source: "gateway" },
    ...(options?.locale && { locale: options.locale }),
  })
  return { documentId: draft.documentId, action: "created" }
}

/**
 * Publish all unpublished gateway-sourced documents of a given type.
 * Call after a batch of upsertByGatewayId creates to promote drafts.
 *
 * Strapi v5 entity validator rejects `create({status: "published"})` when
 * manyToOne relation targets use documentId strings — the publish step's
 * internal re-create fails validation. This helper publishes after the fact.
 *
 * Uses strapi.db.query (entity-level) rather than Document Service findMany
 * because Document Service `status: "draft"` only returns documents that have
 * been published at least once then edited. Brand-new draft-only records
 * (freshly created, never published) are invisible to it.
 */
export async function publishDrafts(
  strapi: Core.Strapi,
  uid: string,
): Promise<number> {
  const PAGE_SIZE = 500
  let published = 0
  let offset = 0

  while (true) {
    // Use the entity-level query API to find rows with publishedAt = null,
    // which catches both brand-new drafts and draft versions of published docs.
    const rows = await (strapi.db as any).query(uid).findMany({
      where: { publishedAt: { $null: true }, source: "gateway" },
      select: ["documentId"],
      limit: PAGE_SIZE,
      offset,
      orderBy: { id: "asc" },
    })

    if (rows.length === 0) break

    // Deduplicate documentIds (localized types can have multiple draft rows
    // per document, one per locale — publish once per documentId is enough).
    const uniqueDocIds = [
      ...new Set<string>(rows.map((r: { documentId: string }) => r.documentId)),
    ]

    for (const documentId of uniqueDocIds) {
      try {
        await docs(strapi, uid).publish({ documentId })
        published++
      } catch (err) {
        strapi.log.warn(
          `[publishDrafts] ${uid}: publish(${documentId}) failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return published
}

/**
 * Repair video child join-table links after publishing videos.
 *
 * Strapi v5 publishes a document by creating a new DB row with a new numeric
 * id and `published_at` set. Child records (variants, subtitles, citations,
 * study-questions) were created as drafts and their `*_video_lnk` join tables
 * store the DRAFT video row's numeric id. After videos are published the link
 * tables still point to the draft rows (`published_at = null`), so Strapi's
 * entity validator rejects child publishes with:
 *   "1 relation(s) of type api::video.video associated with this entity do not exist"
 *
 * This helper updates all four join tables to point to the PUBLISHED video
 * rows so `publishDrafts` can then succeed for the child content types.
 * Must be called AFTER `publishDrafts("api::video.video")` and BEFORE
 * `publishDrafts` for video-subtitle, video-variant, bible-citation, and
 * video-study-question.
 */
export async function repairVideoChildRelationLinks(
  strapi: Core.Strapi,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex = strapi.db.connection as any

  // Load all (document_id → published numeric id) pairs for videos
  const publishedVideos: Array<{ published_id: number; document_id: string }> =
    await knex("videos")
      .whereNotNull("published_at")
      .select("id as published_id", "document_id")

  if (publishedVideos.length === 0) return

  for (const { published_id, document_id } of publishedVideos) {
    const draft: { draft_id: number } | undefined = await knex("videos")
      .whereNull("published_at")
      .where("document_id", document_id)
      .select("id as draft_id")
      .first()

    if (!draft) continue

    const { draft_id } = draft

    // Redirect child join tables from draft video row → published video row
    await Promise.all([
      knex("video_subtitles_video_lnk")
        .where("video_id", draft_id)
        .update({ video_id: published_id }),
      knex("video_variants_video_lnk")
        .where("video_id", draft_id)
        .update({ video_id: published_id }),
      knex("bible_citations_video_lnk")
        .where("video_id", draft_id)
        .update({ video_id: published_id }),
      knex("video_study_questions_video_lnk")
        .where("video_id", draft_id)
        .update({ video_id: published_id }),
    ])
  }
}

/**
 * Pre-load all records of a given type into a Map<gatewayId, documentId>.
 * Used to avoid N+1 findByGatewayId calls in sync loops.
 */
export async function buildGatewayIdMap(
  strapi: Core.Strapi,
  uid: string,
  locale?: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const PAGE_SIZE = 1000
  let start = 0

  while (true) {
    const params: Record<string, unknown> = {
      fields: ["documentId", "gatewayId"],
      limit: PAGE_SIZE,
      start,
    }
    if (locale) params.locale = locale

    const batch = await docs(strapi, uid).findMany(params)
    for (const record of batch) {
      const gid = record.gatewayId as string | undefined
      if (gid) map.set(gid, record.documentId)
    }

    if (batch.length < PAGE_SIZE) break
    start += PAGE_SIZE
  }

  return map
}

export async function softDeleteUnseen(
  strapi: Core.Strapi,
  uid: string,
  seenIds: Set<string>,
  locale?: string,
): Promise<number> {
  let count = 0
  const PAGE_SIZE = 500

  try {
    let start = 0

    while (true) {
      const params: Record<string, unknown> = {
        filters: { source: { $eq: "gateway" } },
        fields: ["documentId", "gatewayId"],
        status: "published",
        limit: PAGE_SIZE,
        start,
      }
      if (locale) params.locale = locale

      const batch = await docs(strapi, uid).findMany(params)
      if (batch.length === 0) break

      for (const local of batch) {
        const gid = local.gatewayId as string | undefined
        if (gid && !seenIds.has(gid)) {
          await docs(strapi, uid).unpublish({
            documentId: local.documentId,
            ...(locale && { locale: "*" }),
          })
          count++
        }
      }

      if (batch.length < PAGE_SIZE) break
      start += PAGE_SIZE
    }
  } catch (error) {
    strapi.log.warn(
      `[gateway-sync] Soft-delete pass for ${uid} failed: ${formatError(error)}`,
    )
  }
  return count
}
