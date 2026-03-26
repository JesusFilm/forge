/**
 * Bulk upsert helper — bypasses Strapi's document service for raw SQL speed.
 *
 * Strapi v5 stores each published document as TWO rows:
 *   - Draft row:     published_at = NULL
 *   - Published row: published_at = <timestamp>
 *
 * Relations (manyToOne) are stored in link tables:
 *   - Draft source row  → draft target row
 *   - Published source  → published target row
 */

import type { Core } from "@strapi/strapi"
import { randomUUID } from "crypto"

/** Generate a Strapi v5–style document ID (24-char lowercase alphanumeric). */
function generateDocumentId(): string {
  // Use UUID v4 (unbiased) and strip hyphens to get 32 hex chars, then take 24
  return randomUUID().replace(/-/g, "").slice(0, 24)
}

type ExistingRecord = {
  documentId: string
  draftId: number
  publishedId: number
  source: string | null
}

export type LinkConfig = {
  /** Link table name, e.g. "keywords_language_lnk" */
  linkTable: string
  /** FK column pointing to the source table, e.g. "keyword_id" */
  sourceColumn: string
  /** Target table name, e.g. "languages" */
  targetTable: string
  /** FK column pointing to the target table, e.g. "language_id" */
  targetColumn: string
  /** Locale of the target table rows ("en" for localized, "" for non-localized) */
  targetLocale: string
  /** Order column, e.g. "keyword_ord". Omit for oneToOne relations. */
  orderColumn?: string
}

export type BulkRecord = {
  coreId: string
  /** Column data using DB column names (snake_case). Exclude system columns. */
  data: Record<string, unknown>
  /** Map from linkTable name → target documentId (or undefined to clear) */
  links?: Record<string, string | undefined>
}

export type BulkStats = {
  created: number
  updated: number
  skipped: number
  errors: number
}

export async function bulkUpsertByCoreId(
  strapi: Core.Strapi,
  config: {
    tableName: string
    locale: string
    linkConfigs: LinkConfig[]
  },
  records: BulkRecord[],
  progress?: { increment: (count?: number) => void },
): Promise<BulkStats> {
  const knex = strapi.db.connection
  const { tableName, locale, linkConfigs } = config
  const stats: BulkStats = { created: 0, updated: 0, skipped: 0, errors: 0 }
  const now = new Date().toISOString()
  const BATCH = 500

  if (records.length === 0) return stats

  // ── Step 1: Load all existing records for this table + locale ──────────
  const existingMap = new Map<string, ExistingRecord>()
  const existingRows: Array<{
    id: number
    document_id: string
    core_id: string
    published_at: string | null
    source: string | null
  }> = await knex(tableName)
    .select("id", "document_id", "core_id", "published_at", "source")
    .where("locale", locale)

  for (const row of existingRows) {
    if (!row.core_id) continue
    const ex = existingMap.get(row.core_id)
    if (ex) {
      if (row.published_at) ex.publishedId = row.id
      else ex.draftId = row.id
    } else {
      existingMap.set(row.core_id, {
        documentId: row.document_id,
        draftId: row.published_at ? 0 : row.id,
        publishedId: row.published_at ? row.id : 0,
        source: row.source,
      })
    }
  }

  // ── Step 2: Classify into creates / updates / skips ────────────────────
  const toCreate: Array<BulkRecord & { documentId: string }> = []
  const toUpdate: Array<BulkRecord & { existing: ExistingRecord }> = []

  for (const rec of records) {
    const ex = existingMap.get(rec.coreId)
    if (ex) {
      if (ex.source === "manager") {
        stats.skipped++
        continue
      }
      toUpdate.push({ ...rec, existing: ex })
    } else {
      toCreate.push({ ...rec, documentId: generateDocumentId() })
    }
  }

  strapi.log.info(
    `[core-sync] Bulk ${tableName}: ${toCreate.length} to create, ${toUpdate.length} to update, ${stats.skipped} skipped`,
  )

  // ── Step 3: Batch INSERT new records (draft + published rows) ──────────
  const newIds = new Map<
    string,
    { draftId: number; publishedId: number; documentId: string }
  >()

  for (let i = 0; i < toCreate.length; i += BATCH) {
    const batch = toCreate.slice(i, i + BATCH)
    try {
      const draftInserts = batch.map((r) => ({
        document_id: r.documentId,
        core_id: r.coreId,
        source: "core",
        locale,
        created_at: now,
        updated_at: now,
        ...r.data,
      }))
      const draftResult: Array<{ id: number; core_id: string }> = await knex(
        tableName,
      )
        .insert(draftInserts)
        .returning(["id", "core_id"])

      const pubInserts = batch.map((r) => ({
        document_id: r.documentId,
        core_id: r.coreId,
        source: "core",
        locale,
        created_at: now,
        updated_at: now,
        published_at: now,
        ...r.data,
      }))
      const pubResult: Array<{ id: number; core_id: string }> = await knex(
        tableName,
      )
        .insert(pubInserts)
        .returning(["id", "core_id"])

      for (let j = 0; j < batch.length; j++) {
        newIds.set(batch[j]!.coreId, {
          draftId: draftResult[j]!.id,
          publishedId: pubResult[j]!.id,
          documentId: batch[j]!.documentId,
        })
      }
      stats.created += batch.length
    } catch (error) {
      strapi.log.warn(
        `[core-sync] Bulk insert batch failed for ${tableName}, falling back to individual: ${error}`,
      )
      for (const rec of batch) {
        try {
          const row = {
            document_id: rec.documentId,
            core_id: rec.coreId,
            source: "core",
            locale,
            created_at: now,
            updated_at: now,
            ...rec.data,
          }
          const [draft] = (await knex(tableName)
            .insert(row)
            .returning(["id"])) as [{ id: number }]
          const [pub] = (await knex(tableName)
            .insert({ ...row, published_at: now })
            .returning(["id"])) as [{ id: number }]
          newIds.set(rec.coreId, {
            draftId: draft.id,
            publishedId: pub.id,
            documentId: rec.documentId,
          })
          stats.created++
        } catch {
          stats.errors++
        }
      }
    }
    progress?.increment(batch.length)
  }

  // ── Step 4: Update existing records (by PK — fast with index) ──────────
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const batch = toUpdate.slice(i, i + BATCH)
    for (const rec of batch) {
      try {
        const updates = {
          ...rec.data,
          source: "core" as const,
          updated_at: now,
        }
        if (rec.existing.draftId) {
          await knex(tableName)
            .where("id", rec.existing.draftId)
            .update(updates)
        }
        if (rec.existing.publishedId) {
          await knex(tableName)
            .where("id", rec.existing.publishedId)
            .update({ ...updates, published_at: now })
        }
        stats.updated++
      } catch {
        stats.errors++
      }
    }
    progress?.increment(batch.length)
  }

  // ── Step 5: Handle link tables ─────────────────────────────────────────
  for (const lc of linkConfigs) {
    // Delete old links for updated records
    const updateSourceIds: number[] = []
    for (const rec of toUpdate) {
      if (rec.existing.draftId) updateSourceIds.push(rec.existing.draftId)
      if (rec.existing.publishedId)
        updateSourceIds.push(rec.existing.publishedId)
    }
    for (let i = 0; i < updateSourceIds.length; i += 1000) {
      await knex(lc.linkTable)
        .whereIn(lc.sourceColumn, updateSourceIds.slice(i, i + 1000))
        .delete()
    }

    // Collect target documentIds we need to resolve
    const targetDocIds = new Set<string>()
    for (const rec of [...toCreate, ...toUpdate]) {
      const targetDocId = rec.links?.[lc.linkTable]
      if (targetDocId) targetDocIds.add(targetDocId)
    }
    if (targetDocIds.size === 0) continue

    // Load target row IDs (draft + published) for the required documentIds
    const targetMap = new Map<
      string,
      { draftId: number; publishedId: number }
    >()
    const docIdArray = [...targetDocIds]
    for (let i = 0; i < docIdArray.length; i += 1000) {
      const chunk = docIdArray.slice(i, i + 1000)
      const targetRows: Array<{
        id: number
        document_id: string
        published_at: string | null
      }> = await knex(lc.targetTable)
        .select("id", "document_id", "published_at")
        .whereIn("document_id", chunk)
        .where("locale", lc.targetLocale)

      for (const row of targetRows) {
        const t = targetMap.get(row.document_id)
        if (t) {
          if (row.published_at) t.publishedId = row.id
          else t.draftId = row.id
        } else {
          targetMap.set(row.document_id, {
            draftId: row.published_at ? 0 : row.id,
            publishedId: row.published_at ? row.id : 0,
          })
        }
      }
    }

    // Build link rows for creates and updates
    const linkRows: Record<string, unknown>[] = []

    function makeLinkRow(sourceId: number, targetId: number) {
      const row: Record<string, unknown> = {
        [lc.sourceColumn]: sourceId,
        [lc.targetColumn]: targetId,
      }
      if (lc.orderColumn) row[lc.orderColumn] = 1
      return row
    }

    for (const rec of toCreate) {
      const targetDocId = rec.links?.[lc.linkTable]
      if (!targetDocId) continue
      const target = targetMap.get(targetDocId)
      const source = newIds.get(rec.coreId)
      if (!target || !source) continue

      if (source.draftId && target.draftId) {
        linkRows.push(makeLinkRow(source.draftId, target.draftId))
      }
      if (source.publishedId && target.publishedId) {
        linkRows.push(makeLinkRow(source.publishedId, target.publishedId))
      }
    }

    for (const rec of toUpdate) {
      const targetDocId = rec.links?.[lc.linkTable]
      if (!targetDocId) continue
      const target = targetMap.get(targetDocId)
      if (!target) continue

      if (rec.existing.draftId && target.draftId) {
        linkRows.push(makeLinkRow(rec.existing.draftId, target.draftId))
      }
      if (rec.existing.publishedId && target.publishedId) {
        linkRows.push(makeLinkRow(rec.existing.publishedId, target.publishedId))
      }
    }

    // Batch insert link rows
    for (let i = 0; i < linkRows.length; i += BATCH) {
      await knex(lc.linkTable).insert(linkRows.slice(i, i + BATCH))
    }

    strapi.log.info(
      `[core-sync] Bulk ${tableName}: inserted ${linkRows.length} link rows into ${lc.linkTable}`,
    )
  }

  return stats
}
