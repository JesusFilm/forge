import { spawn } from "node:child_process"
import { gzipSync } from "node:zlib"
import type { Core } from "@strapi/strapi"

import {
  deleteSnapshot,
  getSnapshotPresignedUrl,
  listSnapshots,
  uploadSnapshot,
} from "./s3-client"
import { SNAPSHOT_TABLES, SNAPSHOT_TABLE_GLOBS } from "./snapshot-tables"

const BACKUP_PREFIX = "backups/"
const MAX_SNAPSHOTS = 2

type SnapshotStatus = {
  inProgress: boolean
  lastRun: string | null
  lastResult: SnapshotResult | null
}

type SnapshotResult = {
  key?: string
  duration?: number
  sizeBytes?: number
  error?: string
}

let snapshotInProgress = false
let lastRun: Date | null = null
let lastResult: SnapshotResult | null = null

export function getSnapshotStatus(): SnapshotStatus {
  return {
    inProgress: snapshotInProgress,
    lastRun: lastRun?.toISOString() ?? null,
    lastResult,
  }
}

function buildPgDumpArgs(): string[] {
  const args: string[] = ["--no-owner", "--no-acl", "--format=plain"]

  // Explicit content tables
  for (const table of SNAPSHOT_TABLES) {
    args.push("-t", table)
  }

  // Strapi-generated join and component tables (glob patterns)
  for (const glob of SNAPSHOT_TABLE_GLOBS) {
    args.push("-t", glob)
  }

  return args
}

function runPgDump(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [...buildPgDumpArgs(), databaseUrl]
    const proc = spawn("pg_dump", args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    const chunks: Buffer[] = []
    let stderr = ""

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pg_dump exited with code ${code}: ${stderr}`))
      } else {
        resolve(Buffer.concat(chunks))
      }
    })

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn pg_dump: ${err.message}`))
    })
  })
}

async function enforceRetention(strapi: Core.Strapi): Promise<void> {
  const snapshots = await listSnapshots(BACKUP_PREFIX)
  if (snapshots.length >= MAX_SNAPSHOTS) {
    const oldest = snapshots[0]
    strapi.log.info(`[data-snapshot] Deleting oldest snapshot: ${oldest.key}`)
    await deleteSnapshot(oldest.key)
  }
}

/**
 * Read local import status from the _data_imports table.
 * Only meaningful in non-production environments where data-import is used.
 */
export async function getLocalImportStatus(strapi: Core.Strapi): Promise<{
  lastImportedAt: string | null
  snapshotKey: string | null
}> {
  try {
    const knex = strapi.db.connection
    const exists = await knex.schema.hasTable("_data_imports")
    if (!exists) {
      return { lastImportedAt: null, snapshotKey: null }
    }

    const row = await knex("_data_imports")
      .select("snapshot_key", "applied_at")
      .orderBy("applied_at", "desc")
      .first()

    if (!row) {
      return { lastImportedAt: null, snapshotKey: null }
    }

    const appliedAt =
      row.applied_at instanceof Date
        ? row.applied_at.toISOString()
        : String(row.applied_at)

    return { lastImportedAt: appliedAt, snapshotKey: row.snapshot_key }
  } catch {
    return { lastImportedAt: null, snapshotKey: null }
  }
}

/**
 * Read persistent snapshot metadata from S3 when in-memory state is empty
 * (e.g. after server restart). Returns the latest snapshot key, size, and
 * last modified date so the admin UI can show snapshot info even after restart.
 */
export async function getPersistedSnapshotStatus(): Promise<{
  persistedLastRun: string | null
  latestSnapshot: {
    key: string
    lastModified: string
    sizeBytes: number
  } | null
}> {
  try {
    const snapshots = await listSnapshots(BACKUP_PREFIX)
    if (snapshots.length === 0) {
      return { persistedLastRun: null, latestSnapshot: null }
    }

    const latest = snapshots[snapshots.length - 1]
    return {
      persistedLastRun: latest.lastModified.toISOString(),
      latestSnapshot: {
        key: latest.key,
        lastModified: latest.lastModified.toISOString(),
        sizeBytes: latest.sizeBytes,
      },
    }
  } catch {
    // S3 not configured or unreachable — no persistent data available
    return { persistedLastRun: null, latestSnapshot: null }
  }
}

export async function createSnapshot(
  strapi: Core.Strapi,
): Promise<SnapshotResult> {
  if (snapshotInProgress) {
    strapi.log.warn("[data-snapshot] Snapshot already in progress, skipping")
    return { error: "already in progress" }
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    const error = "DATABASE_URL not set — cannot create snapshot"
    strapi.log.error(`[data-snapshot] ${error}`)
    return { error }
  }

  snapshotInProgress = true
  const startTime = Date.now()

  try {
    strapi.log.info(
      `[data-snapshot] Starting snapshot of ${SNAPSHOT_TABLES.length} content tables`,
    )

    // Step 1: Enforce retention (delete oldest if 2 exist)
    await enforceRetention(strapi)

    // Step 2: Run pg_dump
    strapi.log.info("[data-snapshot] Running pg_dump")
    const sqlDump = await runPgDump(databaseUrl)
    strapi.log.info(
      `[data-snapshot] pg_dump complete: ${(sqlDump.length / 1024 / 1024).toFixed(1)} MB raw`,
    )

    // Step 3: Compress
    const compressed = gzipSync(sqlDump)
    strapi.log.info(
      `[data-snapshot] Compressed: ${(compressed.length / 1024 / 1024).toFixed(1)} MB`,
    )

    // Step 4: Upload to S3
    const dateStr = new Date().toISOString().slice(0, 10)
    const key = `${BACKUP_PREFIX}cms-snapshot-${dateStr}.sql.gz`
    strapi.log.info(`[data-snapshot] Uploading to ${key}`)
    await uploadSnapshot(key, compressed)

    const duration = Date.now() - startTime
    const result: SnapshotResult = {
      key,
      duration,
      sizeBytes: compressed.length,
    }

    lastRun = new Date()
    lastResult = result

    strapi.log.info(
      `[data-snapshot] Snapshot complete in ${(duration / 1000).toFixed(1)}s`,
    )

    return result
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    strapi.log.error(`[data-snapshot] Snapshot failed: ${errorMessage}`)

    const result: SnapshotResult = { duration, error: errorMessage }
    lastRun = new Date()
    lastResult = result
    return result
  } finally {
    snapshotInProgress = false
  }
}

export async function getLatestDownloadUrl(
  strapi: Core.Strapi,
): Promise<{ url: string; key: string } | null> {
  const snapshots = await listSnapshots(BACKUP_PREFIX)
  if (snapshots.length === 0) {
    strapi.log.warn("[data-snapshot] No snapshots found in S3")
    return null
  }

  // Return pre-signed URL and key for the most recent snapshot
  const latest = snapshots[snapshots.length - 1]
  const url = await getSnapshotPresignedUrl(latest.key)
  return { url, key: latest.key }
}

export default {
  createSnapshot: ({ strapi }: { strapi: Core.Strapi }) =>
    createSnapshot(strapi),
  getLatestDownloadUrl: ({ strapi }: { strapi: Core.Strapi }) =>
    getLatestDownloadUrl(strapi),
  getSnapshotStatus,
}
