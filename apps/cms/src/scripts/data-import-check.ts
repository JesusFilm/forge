/**
 * CMS Data Import Check (Auto Mode)
 *
 * Checks if the latest production snapshot has already been applied.
 * If not, downloads and restores it. If already up to date, skips silently.
 *
 * Designed for automated use:
 * - Turbo pipeline pre-task before `strapi develop`
 * - Railway release command before staging deploy
 *
 * ALWAYS exits 0 — errors are logged as warnings but never block startup.
 *
 * Usage:
 *   pnpm data-import-check
 *
 * Required env vars (same as data-import):
 *   DATABASE_URL              — Local PostgreSQL connection string
 *   PROD_DATA_SNAPSHOT_SECRET — Shared secret for the snapshot API
 *   PROD_BASE_URL             — Base URL of the CMS (e.g. https://cms.example.com)
 */

import {
  createImportClient,
  ensureImportTable,
  getLastAppliedKey,
} from "./import-state"
import {
  assertNotProduction,
  getSnapshotInfo,
  runImportPipeline,
} from "./data-import"

const TAG = "[data-import-check]"

function hasEnv(name: string): string | undefined {
  return process.env[name]
}

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    console.log(`${TAG} Production environment, skipping`)
    return
  }
  assertNotProduction()

  const databaseUrl = hasEnv("DATABASE_URL")
  if (!databaseUrl) {
    console.log(`${TAG} DATABASE_URL not set, skipping`)
    return
  }

  if (!hasEnv("PROD_BASE_URL") || !hasEnv("PROD_DATA_SNAPSHOT_SECRET")) {
    console.log(
      `${TAG} PROD_BASE_URL or PROD_DATA_SNAPSHOT_SECRET not set, skipping`,
    )
    return
  }

  // Step 1: Get latest snapshot info from production
  const { url, key } = await getSnapshotInfo()
  console.log(`${TAG} Latest snapshot: ${key}`)

  // Step 2: Check if this snapshot has already been applied
  const client = await createImportClient(databaseUrl)
  try {
    await ensureImportTable(client)
    const lastKey = await getLastAppliedKey(client)

    if (lastKey === key) {
      console.log(`${TAG} Snapshot already applied, skipping`)
      return
    }

    if (lastKey) {
      console.log(`${TAG} Last applied: ${lastKey}`)
    } else {
      console.log(`${TAG} No previous import found`)
    }
  } finally {
    await client.end()
  }

  // Step 3: Run the full import pipeline
  console.log(`${TAG} New snapshot detected, importing...`)
  await runImportPipeline(databaseUrl, url, key)
}

main().catch((err: unknown) => {
  // Graceful degradation: log warning but always exit 0
  console.warn(
    `${TAG} Import check failed (non-fatal):`,
    err instanceof Error ? err.message : err,
  )
  process.exit(0)
})
