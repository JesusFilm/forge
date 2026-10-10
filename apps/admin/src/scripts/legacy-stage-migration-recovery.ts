import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Client } from "pg"

export const LEGACY_STAGE_MIGRATION =
  "0127_recommendation_legacy_stage_bulk_retirement"

type MigrationIdentity = { migration_name: string; checksum: string }
type MarkerPage = {
  scanned: number
  retired: number
  cursor_time: string | null
  cursor_id: string | null
}
export type LegacyStageRecovery = (
  apply: (alreadyApplied: boolean) => Promise<void>,
) => Promise<void>

export function assertLegacyStageRecoveryIdentity(
  rows: MigrationIdentity[],
  sql: string,
) {
  if (
    rows.length !== 1 ||
    rows[0]?.migration_name !== LEGACY_STAGE_MIGRATION ||
    rows[0]?.checksum !== createHash("sha256").update(sql).digest("hex")
  )
    throw new Error("Legacy stage recovery identity mismatch")
}

/** Autocommitted, idempotent marker updates; never deletes evidence itself. */
export async function prepareLegacyStageMarkers(
  client: Client,
  pageSize = 500,
) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500)
    throw new Error("Invalid legacy marker page size")
  await client.query("SET statement_timeout='5s'; SET lock_timeout='1s'")
  const deadline = performance.now() + 300_000
  let cursorTime: string | null = null
  let cursorId: string | null = null
  let retired = 0
  let scanned = 0
  for (let page = 0; page < 1000; page++) {
    if (performance.now() >= deadline)
      throw new Error("Legacy marker preparation deadline exceeded")
    const { rows }: { rows: MarkerPage[] } = await client.query<MarkerPage>(
      `WITH page AS MATERIALIZED (
        SELECT id, created_at FROM public.recommendation_candidate_run
        WHERE ($1::timestamptz IS NULL OR (created_at,id)>($1::timestamptz,$2::text))
        ORDER BY created_at,id LIMIT $3
      ), changed AS (
        UPDATE public.recommendation_candidate_run c
        SET legacy_detail_retired_at=CURRENT_TIMESTAMP
        FROM page p WHERE c.id=p.id AND c.trace_format_version IS NULL
          AND c.trace_payload IS NULL AND c.legacy_detail_retired_at IS NULL
        RETURNING c.id
      ) SELECT (SELECT count(*)::int FROM page) AS scanned,
        (SELECT count(*)::int FROM changed) AS retired,
        (SELECT created_at::text FROM page ORDER BY created_at DESC,id DESC LIMIT 1) AS cursor_time,
        (SELECT id FROM page ORDER BY created_at DESC,id DESC LIMIT 1) AS cursor_id`,
      [cursorTime, cursorId, pageSize],
    )
    const row: MarkerPage = rows[0]
    scanned += row.scanned
    retired += row.retired
    if (row.scanned === 0) return { scanned, retired, pages: page }
    // Preserve PostgreSQL timestamp precision; never round through a JS Date.
    cursorTime = row.cursor_time
    cursorId = row.cursor_id
    if (page % 20 === 0)
      process.stdout.write(
        `[migrate-deploy] legacy marker preparation pages=${page + 1} retired=${retired}\n`,
      )
  }
  throw new Error("Legacy marker preparation page cap exceeded")
}

/** Serialize HTTP/worker recovery through preparation AND Prisma resolve/deploy. */
export const withLegacyStageRecovery: LegacyStageRecovery = async (apply) => {
  if (!process.env.DATABASE_URL)
    throw new Error("Legacy stage recovery requires DATABASE_URL")
  if (process.env.RECOMMENDATION_CANDIDATE_TRACE_FORMAT !== "compact")
    throw new Error("Legacy stage recovery requires compact writers")
  const sql = await readFile(
    new URL(
      `../../prisma/migrations/${LEGACY_STAGE_MIGRATION}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  )
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 305_000,
    query_timeout: 310_000,
    application_name: "forge-legacy-stage-migration-recovery",
  })
  try {
    await client.connect()
    await client.query("SET lock_timeout='300s'")
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('forge:legacy-stage-recovery:0127',0))",
    )
    await client.query("SET statement_timeout='5s'; SET lock_timeout='1s'")
    const failed = await client.query<MigrationIdentity>(`
      SELECT migration_name,checksum FROM public._prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
      ORDER BY started_at DESC LIMIT 2
    `)
    if (failed.rows.length === 0) {
      const applied = await client.query<MigrationIdentity>(
        `SELECT migration_name,checksum FROM public._prisma_migrations
         WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
        [LEGACY_STAGE_MIGRATION],
      )
      assertLegacyStageRecoveryIdentity(applied.rows, sql)
      await apply(true)
      return
    }
    assertLegacyStageRecoveryIdentity(failed.rows, sql)
    await prepareLegacyStageMarkers(client)
    await apply(false)
  } finally {
    // Closing this dedicated connection releases the session advisory lock.
    await client.end()
  }
}
