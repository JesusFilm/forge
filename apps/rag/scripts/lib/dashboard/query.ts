import type { PrismaClient } from "../../../src/generated/prisma/index.js"
import { prodReadSchema, type ProdRead } from "./types.js"

export const DASHBOARD_ROW_LIMIT = 1_000

export interface RawIngestedRow {
  key: string
  name: string
  host: string | null
  language: string | null
  embedded_doc_count: bigint | number | string
}
export interface RawAcquiredRow {
  key: string
}

export function shapeProdStatus(
  ingestedRows: RawIngestedRow[],
  acquiredRows: RawAcquiredRow[],
): ProdRead {
  const ingested = ingestedRows
    .filter((row) => row.language != null && row.language !== "")
    .map((row) => ({
      key: row.key,
      name: row.name,
      host: row.host,
      language: row.language as string,
      embedded_doc_count: Number(row.embedded_doc_count),
    }))
  const unclassified = ingestedRows
    .filter((row) => row.language == null || row.language === "")
    .map((row) => ({
      key: row.key,
      name: row.name,
      host: row.host,
      embedded_doc_count: Number(row.embedded_doc_count),
    }))
    .filter((row) => row.embedded_doc_count > 0)
    .sort(
      (a, b) =>
        b.embedded_doc_count - a.embedded_doc_count ||
        a.key.localeCompare(b.key),
    )
  const acquired_keys = [...new Set(acquiredRows.map((row) => row.key))].sort()
  return prodReadSchema.parse({ ingested, acquired_keys, unclassified })
}

type DashboardPrisma = Pick<PrismaClient, "$transaction">

/** Fixed, bounded aggregate reads inside a database-enforced read-only transaction. */
export async function fetchProdStatus(
  client: DashboardPrisma,
): Promise<ProdRead> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`
      const ingestedRows = await tx.$queryRaw<RawIngestedRow[]>`
      SELECT s.key, s.name, s.domain AS host, d.language,
             count(DISTINCT d.id) AS embedded_doc_count
      FROM sources s
      JOIN documents d ON d.source_id = s.id
      JOIN chunks c ON c.document_id = d.id
      JOIN chunk_embeddings ce ON ce.chunk_id = c.id
      GROUP BY s.key, s.name, s.domain, d.language
      ORDER BY s.key, d.language
      LIMIT ${DASHBOARD_ROW_LIMIT}
    `
      const acquiredRows = await tx.$queryRaw<RawAcquiredRow[]>`
      SELECT DISTINCT source_key AS key
      FROM raw_documents
      ORDER BY source_key
      LIMIT ${DASHBOARD_ROW_LIMIT}
    `
      if (
        ingestedRows.length === DASHBOARD_ROW_LIMIT ||
        acquiredRows.length === DASHBOARD_ROW_LIMIT
      )
        throw new Error(
          "dashboard snapshot refused: aggregate row limit reached",
        )
      return shapeProdStatus(ingestedRows, acquiredRows)
    },
    { timeout: 20_000 },
  )
}
