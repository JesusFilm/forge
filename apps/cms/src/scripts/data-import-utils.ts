/**
 * Utility functions for the CMS data-import pipeline.
 * Includes pure helpers (parsing, formatting) and database operations
 * (buildTableDropSql for resolving snapshot table globs).
 */

import pg from "pg"

import { SNAPSHOT_TABLES } from "../api/data-snapshot/services/snapshot-tables"

export type DbConfig = {
  host: string
  port: string
  user: string
  database: string
  password: string
  sslmode: string
}

export function parseConnectionString(url: string): DbConfig {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    database: parsed.pathname.replace(/^\//, ""),
    password: decodeURIComponent(parsed.password),
    sslmode: parsed.searchParams.get("sslmode") ?? "prefer",
  }
}

/**
 * Returns true if the SQL line should be kept (not stripped).
 *
 * Strips:
 * - CREATE PUBLICATION statements (replication config from production)
 * - ALTER PUBLICATION statements
 * - psql meta-commands (lines starting with \) except \. (COPY terminator) and \copy
 */
export function shouldKeepLine(line: string): boolean {
  if (/^\s*CREATE\s+PUBLICATION\s/i.test(line)) return false
  if (/^\s*ALTER\s+PUBLICATION\s/i.test(line)) return false
  // PG 17+ parameters not recognized by older local PostgreSQL versions
  if (/^\s*SET\s+transaction_timeout\s/i.test(line)) return false
  // Strip session_replication_role resets — we set it to 'replica' at the top
  // of the processed file to disable FK checks during restore (the snapshot
  // omits Strapi admin tables that content rows reference).
  if (/^\s*SET\s+session_replication_role\s/i.test(line)) return false
  if (/^\\/.test(line) && !/^\\\./.test(line) && !/^\\copy/i.test(line)) {
    return false
  }
  return true
}

/**
 * Generates DROP TABLE IF EXISTS statements for the given table names.
 */
export function buildTableDropSql(tables: string[]): string {
  if (tables.length === 0) return ""
  return tables
    .map((t) => `DROP TABLE IF EXISTS "${t.replace(/"/g, '""')}" CASCADE;`)
    .join("\n")
}

/**
 * Scans a decompressed pg_dump SQL file and extracts the table names
 * from CREATE TABLE statements. Only these tables should be dropped
 * before restore — tables in the allowlist but not in the dump
 * (e.g. newly added) must be left alone.
 */
export async function extractTablesFromDump(
  sqlPath: string,
): Promise<string[]> {
  const { createReadStream } = await import("node:fs")
  const { createInterface } = await import("node:readline")

  const tables: string[] = []
  const rl = createInterface({
    input: createReadStream(sqlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    // pg_dump emits: CREATE TABLE public.tablename (
    const match = line.match(/^\s*CREATE\s+TABLE\s+public\.(\S+)\s/i)
    if (match) {
      tables.push(match[1].replace(/"/g, ""))
    }
  }

  return tables
}

/**
 * NULLs out created_by_id and updated_by_id in all snapshot tables.
 * These columns reference admin_users which is not included in the snapshot.
 * Strapi recreates the FK constraints on boot, so the values must be valid.
 */
export async function nullifyAdminRefs(databaseUrl: string): Promise<number> {
  const client = new pg.Client({ connectionString: databaseUrl })
  let updated = 0

  try {
    await client.connect()

    // Build a single batch of UPDATE statements to avoid N+1 round trips.
    // Only targets tables that actually have created_by_id/updated_by_id.
    const colResult = await client.query<{
      table_name: string
      column_name: string
    }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
       AND table_name = ANY($1)
       AND column_name IN ('created_by_id', 'updated_by_id')`,
      [Array.from(SNAPSHOT_TABLES)],
    )

    // Group columns by table
    const tableColumns = new Map<string, string[]>()
    for (const row of colResult.rows) {
      const cols = tableColumns.get(row.table_name) ?? []
      cols.push(row.column_name)
      tableColumns.set(row.table_name, cols)
    }

    const esc = (id: string) => `"${id.replace(/"/g, '""')}"`

    for (const [table, cols] of tableColumns) {
      const setClauses = cols.map((c) => `${esc(c)} = NULL`).join(", ")
      const whereClauses = cols.map((c) => `${esc(c)} IS NOT NULL`).join(" OR ")
      const result = await client.query(
        `UPDATE ${esc(table)} SET ${setClauses} WHERE ${whereClauses}`,
      )
      if (result.rowCount && result.rowCount > 0) {
        updated += result.rowCount
      }
    }
  } finally {
    await client.end()
  }

  return updated
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
