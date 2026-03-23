/**
 * Pure utility functions for the CMS data-import pipeline.
 * Extracted for testability — no side effects, no process.exit, no I/O.
 */

// ---------------------------------------------------------------------------
// Connection string parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SQL preprocessing
// ---------------------------------------------------------------------------

/**
 * Returns true if the SQL line should be kept (not stripped).
 *
 * Strips:
 * - CREATE PUBLICATION statements (replication config from production)
 * - ALTER PUBLICATION statements
 * - psql meta-commands (lines starting with \) except \. (COPY terminator) and \copy
 */
export function shouldKeepLine(line: string): boolean {
  // Strip CREATE PUBLICATION statements
  if (/^\s*CREATE\s+PUBLICATION\s/i.test(line)) return false

  // Strip ALTER PUBLICATION statements
  if (/^\s*ALTER\s+PUBLICATION\s/i.test(line)) return false

  // Strip psql meta-commands except \. (COPY terminator) and \copy
  if (/^\\/.test(line) && !/^\\\./.test(line) && !/^\\copy/i.test(line)) {
    return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Byte formatting
// ---------------------------------------------------------------------------

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
