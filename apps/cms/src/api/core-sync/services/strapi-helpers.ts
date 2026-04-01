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

export type CoreTranslation = {
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

export type PhaseProgress = {
  processed: number
  total: number | null
}

export type ProgressReporter = {
  setTotal: (total: number) => void
  increment: (count?: number) => void
}

export function docs(strapi: Core.Strapi, uid: string): DocumentService {
  return strapi.documents(uid as never) as unknown as DocumentService
}

export function getPrimaryValue(translations: CoreTranslation[]): string {
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

export async function findByCoreId(
  strapi: Core.Strapi,
  uid: string,
  coreId: string,
  locale?: string,
): Promise<AnyDocument | null> {
  const params: Record<string, unknown> = {
    filters: { coreId: { $eq: coreId } },
  }
  if (locale) params.locale = locale
  return docs(strapi, uid).findFirst(params)
}

export async function upsertByCoreId(
  strapi: Core.Strapi,
  uid: string,
  coreId: string,
  data: Record<string, unknown>,
  options?: { locale?: string },
): Promise<{ documentId: string; action: "created" | "updated" | "skipped" }> {
  const existing = await findByCoreId(strapi, uid, coreId, options?.locale)

  if (existing) {
    if (existing.source === "manager") {
      return { documentId: existing.documentId, action: "skipped" }
    }
    await docs(strapi, uid).update({
      documentId: existing.documentId,
      data: { ...data, coreId, source: "core" },
      ...(options?.locale && { locale: options.locale }),
      status: "published",
    })
    return { documentId: existing.documentId, action: "updated" }
  }

  const created = await docs(strapi, uid).create({
    data: { ...data, coreId, source: "core" },
    ...(options?.locale && { locale: options.locale }),
    status: "published",
  })
  return { documentId: created.documentId, action: "created" }
}

/**
 * Pre-load all records of a given type into a Map<coreId, documentId>.
 * Used to avoid N+1 findByCoreId calls in sync loops.
 */
export async function buildCoreIdMap(
  strapi: Core.Strapi,
  uid: string,
  locale?: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const PAGE_SIZE = 1000
  let start = 0

  while (true) {
    const params: Record<string, unknown> = {
      fields: ["documentId", "coreId"],
      limit: PAGE_SIZE,
      start,
    }
    if (locale) params.locale = locale

    const batch = await docs(strapi, uid).findMany(params)
    for (const record of batch) {
      const gid = record.coreId as string | undefined
      if (gid) map.set(gid, record.documentId)
    }

    if (batch.length < PAGE_SIZE) break
    start += PAGE_SIZE
  }

  return map
}

// ---------------------------------------------------------------------------
// Sync-state persistence (raw knex — no Strapi content type needed)
// ---------------------------------------------------------------------------

const SYNC_STATE_TABLE = "core_sync_states"
let tableEnsured = false

/** Ensure the sync-state table exists (idempotent, cached after first check). */
export async function ensureSyncStateTable(strapi: Core.Strapi): Promise<void> {
  if (tableEnsured) return
  const knex = strapi.db.connection
  const exists = await knex.schema.hasTable(SYNC_STATE_TABLE)
  if (!exists) {
    await knex.schema.createTable(SYNC_STATE_TABLE, (t) => {
      t.string("phase").primary()
      t.timestamp("last_synced_at").notNullable()
    })
    strapi.log.info(`[core-sync] Created ${SYNC_STATE_TABLE} table`)
  }
  tableEnsured = true
}

/** Read the last successful sync timestamp for a phase (null = never synced). */
export async function getLastSyncTime(
  strapi: Core.Strapi,
  phase: string,
): Promise<string | null> {
  const knex = strapi.db.connection
  const row = await knex(SYNC_STATE_TABLE).where({ phase }).first()
  if (!row?.last_synced_at) return null
  // knex/pg returns timestamptz as a JS Date — convert to ISO string for the Core API
  const val = row.last_synced_at
  return val instanceof Date ? val.toISOString() : String(val)
}

/** Read the most recent sync timestamp across all phases (null = never synced). */
export async function getAllSyncTimes(
  strapi: Core.Strapi,
): Promise<{ phase: string; lastSyncedAt: string }[]> {
  const knex = strapi.db.connection
  const exists = await knex.schema.hasTable(SYNC_STATE_TABLE)
  if (!exists) return []
  const rows = await knex(SYNC_STATE_TABLE)
    .select("phase", "last_synced_at")
    .orderBy("last_synced_at", "desc")
  return rows.map((row: { phase: string; last_synced_at: Date | string }) => ({
    phase: row.phase,
    lastSyncedAt:
      row.last_synced_at instanceof Date
        ? row.last_synced_at.toISOString()
        : String(row.last_synced_at),
  }))
}

/** Persist the sync timestamp for a phase after a successful run. */
export async function setLastSyncTime(
  strapi: Core.Strapi,
  phase: string,
  timestamp: string,
): Promise<void> {
  const knex = strapi.db.connection
  await knex(SYNC_STATE_TABLE)
    .insert({ phase, last_synced_at: timestamp })
    .onConflict("phase")
    .merge()
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
        filters: { source: { $eq: "core" } },
        fields: ["documentId", "coreId"],
        status: "published",
        limit: PAGE_SIZE,
        start,
      }
      if (locale) params.locale = locale

      const batch = await docs(strapi, uid).findMany(params)
      if (batch.length === 0) break

      for (const local of batch) {
        const gid = local.coreId as string | undefined
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
      `[core-sync] Soft-delete pass for ${uid} failed: ${formatError(error)}`,
    )
  }
  return count
}
