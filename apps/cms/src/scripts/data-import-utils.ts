/**
 * Utility functions for the CMS data-import pipeline.
 * Includes pure helpers (parsing, formatting) and database operations
 * (buildTableDropSql for resolving snapshot table globs).
 */

import pg from "pg"

import {
  SNAPSHOT_TABLES,
  SNAPSHOT_TABLE_GLOBS,
} from "../api/data-snapshot/services/snapshot-tables"

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
  if (/^\\/.test(line) && !/^\\\./.test(line) && !/^\\copy/i.test(line)) {
    return false
  }
  return true
}

/**
 * Connects to the database and resolves SNAPSHOT_TABLES + SNAPSHOT_TABLE_GLOBS
 * into concrete DROP TABLE IF EXISTS statements for content tables only.
 *
 * Returns an empty string if no matching tables exist (fresh database).
 */
export async function buildTableDropSql(databaseUrl: string): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()

    // Resolve glob patterns to actual table names using LIKE
    const likePatterns = SNAPSHOT_TABLE_GLOBS.map((g) => g.replace(/\*/g, "%"))
    const likeConditions = likePatterns.map(
      (_, i) => `table_name LIKE $${i + 1}`,
    )

    let globTables: string[] = []
    if (likeConditions.length > 0) {
      const query = `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (${likeConditions.join(" OR ")})`
      const result = await client.query<{ table_name: string }>(
        query,
        likePatterns,
      )
      globTables = result.rows.map((r) => r.table_name)
    }

    // Combine explicit tables with glob-resolved tables, deduplicated
    const allTables = Array.from(new Set([...SNAPSHOT_TABLES, ...globTables]))

    if (allTables.length === 0) return ""

    return allTables
      .map((t) => `DROP TABLE IF EXISTS "${t.replace(/"/g, '""')}" CASCADE;`)
      .join("\n")
  } finally {
    await client.end()
  }
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
