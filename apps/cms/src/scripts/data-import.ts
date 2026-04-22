/**
 * CMS Data Import
 *
 * Downloads the latest production snapshot via the Strapi data-snapshot endpoint
 * and restores it into the local PostgreSQL instance. Replaces running core-sync
 * locally (which takes 4+ hours).
 *
 * Usage:
 *   pnpm data-import
 *
 * Required env vars:
 *   DATABASE_URL              — Local PostgreSQL connection string
 *   PROD_DATA_SNAPSHOT_SECRET      — Shared secret for the snapshot API
 *   PROD_BASE_URL          — Base URL of the CMS (e.g. https://cms.example.com)
 */

import "dotenv/config"

import { spawn } from "node:child_process"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises"
import { createGunzip } from "node:zlib"
import { createInterface } from "node:readline"
import { pipeline } from "node:stream/promises"
import { Readable, Transform } from "node:stream"

import pg from "pg"

import {
  type DbConfig,
  analyzeDatabase,
  backfillBooleanDefaults,
  buildTableDropSql,
  extractTablesFromDump,
  formatBytes,
  nullifyAdminRefs,
  parseConnectionString,
  shouldKeepLine,
} from "./data-import-utils"
import {
  createImportClient,
  ensureImportTable,
  recordImport,
} from "./import-state"

const CACHE_DIR = "./.tmp"
const WORK_DIR = "./.tmp/import-work"

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function assertNotProduction(): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "Refusing to run data-import with NODE_ENV=production. " +
        "This script drops and restores content tables and is only safe for dev/staging.",
    )
  }
}

// ---------------------------------------------------------------------------
// Download via Strapi endpoint
// ---------------------------------------------------------------------------

export async function getSnapshotInfo(): Promise<{ url: string; key: string }> {
  const baseUrl = requiredEnv("PROD_BASE_URL")
  // PROD_ prefix distinguishes the *remote* production CMS secret from the
  // server-side DATA_SNAPSHOT_SECRET that the production CMS itself checks.
  const secret = requiredEnv("PROD_DATA_SNAPSHOT_SECRET")

  const response = await fetch(`${baseUrl}/api/data-snapshot/download`, {
    headers: { "x-snapshot-secret": secret },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to get snapshot URL: ${response.status} ${response.statusText} — ${body}`,
    )
  }

  const data = (await response.json()) as { url: string; key: string }
  return data
}

async function downloadSnapshot(
  destPath: string,
  presignedUrl: string,
): Promise<void> {
  console.log("[data-import] Downloading snapshot")
  const startTime = Date.now()

  const response = await fetch(presignedUrl)
  if (!response.ok || !response.body) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    )
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0)
  let bytesReceived = 0
  let lastLoggedPct = -10

  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesReceived += chunk.length
      if (contentLength > 0) {
        const pct = (bytesReceived / contentLength) * 100
        if (pct - lastLoggedPct >= 10 || pct >= 100) {
          lastLoggedPct = Math.floor(pct / 10) * 10
          console.log(
            `[data-import] Download progress: ${pct.toFixed(1)}% (${formatBytes(bytesReceived)} / ${formatBytes(contentLength)})`,
          )
        }
      } else {
        const mb = Math.floor(bytesReceived / (1024 * 1024))
        const prevMb = Math.floor(
          (bytesReceived - chunk.length) / (1024 * 1024),
        )
        if (mb > prevMb) {
          console.log(`[data-import] Downloaded: ${formatBytes(bytesReceived)}`)
        }
      }
      callback(null, chunk)
    },
  })

  const bodyStream = Readable.fromWeb(response.body as ReadableStream)
  const dest = createWriteStream(destPath)
  await pipeline(bodyStream, progress, dest)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(
    `\n[data-import] Download complete: ${formatBytes(bytesReceived)} in ${elapsed}s`,
  )
}

// ---------------------------------------------------------------------------
// Decompress
// ---------------------------------------------------------------------------

async function decompress(gzPath: string, outPath: string): Promise<void> {
  console.log("[data-import] Decompressing")
  const startTime = Date.now()

  await pipeline(
    createReadStream(gzPath),
    createGunzip(),
    createWriteStream(outPath),
  )

  const gzSize = (await stat(gzPath)).size
  const rawSize = (await stat(outPath)).size
  const ratio = rawSize > 0 ? ((gzSize / rawSize) * 100).toFixed(1) : "N/A"
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log(
    `[data-import] Decompressed: ${formatBytes(gzSize)} → ${formatBytes(rawSize)} (${ratio}% ratio) in ${elapsed}s`,
  )
}

// ---------------------------------------------------------------------------
// pgvector detection
// ---------------------------------------------------------------------------

/** Embedding tables that require pgvector to restore. */
const PGVECTOR_TABLES = new Set(["scene_embeddings", "transcript_embeddings"])

/**
 * Checks if the local PostgreSQL instance supports pgvector.
 * If available, enables the extension and returns true.
 * Otherwise returns false — embedding tables will be skipped during import.
 */
async function ensurePgvectorLocal(databaseUrl: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query("CREATE EXTENSION IF NOT EXISTS vector")
    return true
  } catch {
    return false
  } finally {
    await client.end()
  }
}

// ---------------------------------------------------------------------------
// Preprocess SQL
// ---------------------------------------------------------------------------

async function preprocessSql(
  inputPath: string,
  outputPath: string,
  dropTablesSql: string,
  hasPgvector: boolean,
): Promise<void> {
  console.log("[data-import] Preprocessing SQL")
  const startTime = Date.now()

  const input = createReadStream(inputPath, { encoding: "utf-8" })
  const output = createWriteStream(outputPath, { encoding: "utf-8" })
  const rl = createInterface({ input, crlfDelay: Infinity })

  // Disable FK checks during restore — production rows reference admin_users
  // and other Strapi tables not included in the content snapshot.
  output.write("SET session_replication_role = 'replica';\n\n")

  // Prepend targeted DROP TABLE statements for snapshot content tables only
  if (dropTablesSql) {
    output.write(dropTablesSql + "\n\n")
  }

  let linesRead = 0
  let linesStripped = 0
  let pendingAlterTable: string | null = null
  // When pgvector is unavailable, skip entire blocks related to embedding tables.
  // Tracks whether we're inside a COPY ... FROM stdin block for an embedding table.
  let skippingEmbeddingCopy = false

  for await (const line of rl) {
    linesRead++

    // --- pgvector table filtering (when pgvector is not available) ---
    if (!hasPgvector) {
      // End of a COPY block we're skipping
      if (skippingEmbeddingCopy) {
        if (line === "\\.") {
          skippingEmbeddingCopy = false
          linesStripped++
        } else {
          linesStripped++
        }
        continue
      }

      // Check if this line starts a block for a pgvector table
      const tableMatch = line.match(
        /^\s*(?:CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX|DROP\s+TABLE|COPY)\s+(?:public\.)?(\S+)/i,
      )
      if (tableMatch) {
        const tableName = tableMatch[1].replace(/"/g, "").replace(/\(.*/, "")
        if (PGVECTOR_TABLES.has(tableName)) {
          // Start skipping COPY blocks (they end with \.)
          if (/^\s*COPY\s/i.test(line)) {
            skippingEmbeddingCopy = true
          }
          linesStripped++
          continue
        }
      }
    }

    // Buffer ALTER TABLE ONLY lines — if the next line adds a FK to
    // admin_users (not in the snapshot), drop both lines.
    if (/^\s*ALTER\s+TABLE\s+ONLY\s/i.test(line)) {
      pendingAlterTable = line
      continue
    }

    if (pendingAlterTable !== null) {
      if (/REFERENCES\s+public\.admin_users/i.test(line)) {
        // Drop the ALTER TABLE + ADD CONSTRAINT pair
        linesStripped += 2
        pendingAlterTable = null
        continue
      }
      // Not an admin_users FK — flush the buffered ALTER TABLE line
      output.write(pendingAlterTable + "\n")
      pendingAlterTable = null
    }

    if (shouldKeepLine(line)) {
      output.write(line + "\n")
    } else {
      linesStripped++
    }
  }

  // Flush any trailing buffered ALTER TABLE line
  if (pendingAlterTable !== null) {
    output.write(pendingAlterTable + "\n")
  }

  // Re-enable FK checks after data is loaded
  output.write("\nSET session_replication_role = 'origin';\n")

  output.end()
  await new Promise<void>((resolve, reject) => {
    output.on("finish", resolve)
    output.on("error", reject)
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(
    `[data-import] Preprocessed: ${linesRead} lines read, ${linesStripped} stripped in ${elapsed}s`,
  )
}

// ---------------------------------------------------------------------------
// psql Restore
// ---------------------------------------------------------------------------

async function psqlRestore(db: DbConfig, sqlPath: string): Promise<void> {
  console.log(
    `[data-import] Restoring into ${db.host}:${db.port}/${db.database}`,
  )

  const args: string[] = [
    "-h",
    db.host,
    "-p",
    db.port,
    "-U",
    db.user,
    "-d",
    db.database,
    "-v",
    "ON_ERROR_STOP=1",
    "--single-transaction",
    "-f",
    sqlPath,
  ]

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGPASSWORD: db.password,
    PGSSLMODE: db.sslmode,
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("psql", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stderr = ""
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString()
    })
    proc.stdout.on("data", (data: Buffer) => {
      process.stdout.write(data)
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error(`[data-import] psql exited with code ${code}`)
        if (stderr) console.error(`[data-import] stderr:\n${stderr}`)
        reject(new Error(`psql restore failed with exit code ${code}`))
      } else {
        console.log("[data-import] Restore complete")
        resolve()
      }
    })

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn psql: ${err.message}`))
    })
  })
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  // Remove intermediate work files but keep the cached .gz in CACHE_DIR
  await rm(WORK_DIR, { recursive: true, force: true }).catch(() => {})
  console.log("[data-import] Work files cleaned up")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Runs the full import pipeline: download, decompress, preprocess, restore, record state.
 * Exported so data-import-check.ts can reuse it.
 */
export async function runImportPipeline(
  databaseUrl: string,
  snapshotUrl: string,
  snapshotKey: string,
): Promise<void> {
  const db = parseConnectionString(databaseUrl)
  console.log(`[data-import] Target: ${db.host}:${db.port}/${db.database}`)
  console.log("\u2500".repeat(60))

  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(WORK_DIR, { recursive: true })

  // Cache snapshot by key name (e.g. cms-snapshot-2026-03-31.sql.gz)
  const snapshotFilename = snapshotKey.split("/").pop() ?? "snapshot.sql.gz"
  const gzPath = `${CACHE_DIR}/${snapshotFilename}`
  const sqlPath = `${WORK_DIR}/snapshot.sql`
  const processedPath = `${WORK_DIR}/snapshot-processed.sql`

  try {
    // Only download if not already cached
    let cached = false
    try {
      await stat(gzPath)
      cached = true
    } catch {
      // File doesn't exist
    }

    if (cached) {
      console.log(`\n[Step 1/9] Using cached snapshot: ${gzPath}`)
    } else {
      console.log("\n[Step 1/9] Downloading snapshot from CMS")
      const tmpPath = `${gzPath}.tmp`
      await downloadSnapshot(tmpPath, snapshotUrl)
      // Atomic rename — only replace cache after successful download
      await rename(tmpPath, gzPath)
      // Remove old cached snapshots
      const files = await readdir(CACHE_DIR)
      for (const f of files) {
        if (f.endsWith(".sql.gz") && f !== snapshotFilename) {
          await rm(`${CACHE_DIR}/${f}`, { force: true }).catch(() => {})
        }
      }
    }

    console.log("\n[Step 2/9] Decompressing")
    await decompress(gzPath, sqlPath)

    console.log("\n[Step 3/9] Checking pgvector availability")
    const hasPgvector = await ensurePgvectorLocal(databaseUrl)
    if (hasPgvector) {
      console.log(
        "[data-import] pgvector enabled — embedding tables will be imported",
      )
    } else {
      console.log(
        "[data-import] pgvector NOT available — embedding tables will be skipped\n" +
          "  To enable: change .devcontainer/docker-compose.yml db image to pgvector/pgvector:pg16\n" +
          "  Then rebuild the devcontainer and re-run data-import",
      )
    }

    console.log("\n[Step 4/9] Preprocessing SQL")
    const dumpTables = await extractTablesFromDump(sqlPath)
    console.log(`[data-import] Found ${dumpTables.length} tables in dump`)
    const dropTablesSql = buildTableDropSql(dumpTables)
    await preprocessSql(sqlPath, processedPath, dropTablesSql, hasPgvector)

    console.log("\n[Step 5/9] Restoring database")
    await psqlRestore(db, processedPath)

    console.log("\n[Step 6/9] Nullifying admin_users references")
    const rowsUpdated = await nullifyAdminRefs(databaseUrl)
    console.log(
      `[data-import] Nullified created_by_id/updated_by_id in ${rowsUpdated} rows`,
    )

    console.log("\n[Step 7/9] Backfilling required boolean defaults")
    const boolsFixed = await backfillBooleanDefaults(databaseUrl)
    console.log(
      `[data-import] Backfilled ${boolsFixed} NULL booleans with defaults`,
    )

    console.log("\n[Step 8/9] Updating query planner statistics")
    const analyzeStart = Date.now()
    await analyzeDatabase(databaseUrl)
    console.log(
      `[data-import] ANALYZE completed in ${((Date.now() - analyzeStart) / 1000).toFixed(1)}s`,
    )

    console.log("\n[Step 9/9] Recording import state")
    const client = await createImportClient(databaseUrl)
    try {
      await ensureImportTable(client)
      await recordImport(client, snapshotKey)
      console.log(`[data-import] Import state recorded: ${snapshotKey}`)
    } finally {
      await client.end()
    }
  } finally {
    console.log("\n[Cleanup] Removing work files")
    await cleanup()
  }

  console.log("\n" + "\u2500".repeat(60))
  console.log("[data-import] Import completed successfully")
}

async function main(): Promise<void> {
  assertNotProduction()

  console.log("[data-import] Starting CMS database import (force mode)")
  console.log("\u2500".repeat(60))

  const databaseUrl = requiredEnv("DATABASE_URL")
  const { url, key } = await getSnapshotInfo()
  console.log(`[data-import] Snapshot: ${key}`)

  await runImportPipeline(databaseUrl, url, key)
}

// Only run main() when this file is the direct entry point (not when imported)
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error("[data-import] Fatal error:", err)
    process.exit(1)
  })
}
