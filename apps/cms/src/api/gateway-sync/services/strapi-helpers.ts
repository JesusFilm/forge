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

export type PublishDraftsResult = {
  published: number
  failed: number
  failedDocumentIds: string[]
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

/**
 * Use when a non-localized entry points at a localized target.
 * Strapi publish/re-publish needs the target locale to resolve the
 * correct published entity id from a documentId relation.
 */
export function localizedRelation(
  docId: string | undefined,
  locale = "en",
): { documentId: string; locale: string } | { set: [] } {
  return docId ? { documentId: docId, locale } : { set: [] }
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
 * Uses a direct table query rather than Document Service findMany because
 * Document Service `status: "draft"` only returns documents that have been
 * published at least once then edited. Brand-new draft-only records are
 * invisible to it, and Strapi v5 keeps a draft row after publish, so the
 * finder must select documentIds that either have no published row yet or
 * have a newer draft row that still needs republishing.
 */
export async function publishDrafts(
  strapi: Core.Strapi,
  uid: string,
  options?: { includeUpdatedDrafts?: boolean },
): Promise<PublishDraftsResult> {
  const PAGE_SIZE = 500
  const tableName = (strapi as any).getModel(uid).collectionName as string
  const knex = (strapi.db as any).connection
  const includeUpdatedDrafts = options?.includeUpdatedDrafts ?? false
  let published = 0
  let failed = 0
  const failedDocumentIds: string[] = []
  const attemptedDocumentIds = new Set<string>()

  while (true) {
    const draftRows = knex({ draft: tableName })
      .select("draft.document_id as document_id")
      .max({ draft_updated_at: "draft.updated_at" })
      .where("draft.source", "gateway")
      .whereNull("draft.published_at")
      .groupBy("draft.document_id")
      .as("draft_rows")

    const publishedRows = knex({ published: tableName })
      .select("published.document_id as document_id")
      .max({ published_updated_at: "published.updated_at" })
      .whereNotNull("published.published_at")
      .groupBy("published.document_id")
      .as("published_rows")

    const rows = await knex
      .from(draftRows)
      .leftJoin(
        publishedRows,
        "published_rows.document_id",
        "draft_rows.document_id",
      )
      .select("draft_rows.document_id as documentId")
      .where((builder: any) => {
        builder.whereNull("published_rows.published_updated_at")

        if (includeUpdatedDrafts) {
          builder.orWhere(
            "draft_rows.draft_updated_at",
            ">",
            knex.ref("published_rows.published_updated_at"),
          )
        }
      })
      .limit(PAGE_SIZE)

    if (rows.length === 0) break

    const uniqueDocIds = rows
      .map((r: { documentId: string }) => r.documentId)
      .filter((documentId: string) => !attemptedDocumentIds.has(documentId))

    if (uniqueDocIds.length === 0) break

    for (const documentId of uniqueDocIds) {
      attemptedDocumentIds.add(documentId)
      try {
        await docs(strapi, uid).publish({ documentId })
        published++
      } catch (err) {
        failed++
        failedDocumentIds.push(documentId)
        strapi.log.warn(
          `[publishDrafts] ${uid}: publish(${documentId}) failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    if (rows.length < PAGE_SIZE) break
  }
  return { published, failed, failedDocumentIds }
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
