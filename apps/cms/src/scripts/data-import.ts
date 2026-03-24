/**
 * CMS Data Import
 *
 * Downloads the latest production snapshot via the Strapi data-snapshot endpoint
 * and restores it into the local PostgreSQL instance. Replaces running gateway-sync
 * locally (which takes 4+ hours).
 *
 * Usage:
 *   pnpm data-import
 *
 * Required env vars:
 *   DATABASE_URL              — Local PostgreSQL connection string
 *   PROD_DATA_SNAPSHOT_SECRET      — Shared secret for the snapshot API
 *   CMS_PROD_BASE_URL          — Base URL of the CMS (e.g. https://cms.example.com)
 */

import { spawn } from "node:child_process"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createGunzip } from "node:zlib"
import { createInterface } from "node:readline"
import { pipeline } from "node:stream/promises"
import { Readable, Transform } from "node:stream"

import {
  type DbConfig,
  formatBytes,
  parseConnectionString,
  shouldKeepLine,
} from "./data-import-utils"

const IMPORTS_DIR = "./imports"

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
        "This script runs DROP SCHEMA CASCADE and is only safe for dev/staging.",
    )
  }
}

// ---------------------------------------------------------------------------
// Download via Strapi endpoint
// ---------------------------------------------------------------------------

async function getDownloadUrl(): Promise<string> {
  const baseUrl = requiredEnv("CMS_PROD_BASE_URL")
  const secret = requiredEnv("PROD_DATA_SNAPSHOT_SECRET")

  const response = await fetch(`${baseUrl}/api/data-snapshot/download`, {
    headers: { "x-snapshot-secret": secret },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to get snapshot URL: ${response.status} ${response.statusText} — ${body}`,
    )
  }

  const data = (await response.json()) as { url: string }
  return data.url
}

async function downloadSnapshot(destPath: string): Promise<void> {
  const presignedUrl = await getDownloadUrl()

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

  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesReceived += chunk.length
      if (contentLength > 0) {
        const pct = ((bytesReceived / contentLength) * 100).toFixed(1)
        process.stdout.write(
          `\r[data-import] Download progress: ${pct}% (${formatBytes(bytesReceived)} / ${formatBytes(contentLength)})`,
        )
      } else {
        process.stdout.write(
          `\r[data-import] Downloaded: ${formatBytes(bytesReceived)}`,
        )
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
// Preprocess SQL
// ---------------------------------------------------------------------------

async function preprocessSql(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  console.log("[data-import] Preprocessing SQL")
  const startTime = Date.now()

  const input = createReadStream(inputPath, { encoding: "utf-8" })
  const output = createWriteStream(outputPath, { encoding: "utf-8" })
  const rl = createInterface({ input, crlfDelay: Infinity })

  // Prepend DROP/CREATE inside the transaction so failure rolls back the DROP
  output.write("DROP SCHEMA public CASCADE;\n")
  output.write("CREATE SCHEMA public;\n\n")

  let linesRead = 0
  let linesStripped = 0

  for await (const line of rl) {
    linesRead++
    if (shouldKeepLine(line)) {
      output.write(line + "\n")
    } else {
      linesStripped++
    }
  }

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
// Timestamp tracking
// ---------------------------------------------------------------------------

const TIMESTAMP_FILE = `${IMPORTS_DIR}/.last-import`

async function recordTimestamp(): Promise<void> {
  const now = new Date().toISOString()
  await writeFile(TIMESTAMP_FILE, now, "utf-8")
  console.log(`[data-import] Import timestamp recorded: ${now}`)
}

async function getLastImport(): Promise<string | null> {
  try {
    return (await readFile(TIMESTAMP_FILE, "utf-8")).trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  const files = [
    `${IMPORTS_DIR}/snapshot.sql.gz`,
    `${IMPORTS_DIR}/snapshot.sql`,
    `${IMPORTS_DIR}/snapshot-processed.sql`,
  ]
  for (const file of files) {
    await rm(file, { force: true }).catch(() => {})
  }
  console.log("[data-import] Temp files cleaned up")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  assertNotProduction()

  console.log("[data-import] Starting CMS database import")
  console.log("\u2500".repeat(60))

  const lastImport = await getLastImport()
  if (lastImport) {
    console.log(`[data-import] Last import: ${lastImport}`)
  }

  const databaseUrl = requiredEnv("DATABASE_URL")
  const db = parseConnectionString(databaseUrl)
  console.log(`[data-import] Target: ${db.host}:${db.port}/${db.database}`)
  console.log("\u2500".repeat(60))

  await mkdir(IMPORTS_DIR, { recursive: true })

  const gzPath = `${IMPORTS_DIR}/snapshot.sql.gz`
  const sqlPath = `${IMPORTS_DIR}/snapshot.sql`
  const processedPath = `${IMPORTS_DIR}/snapshot-processed.sql`

  try {
    console.log("\n[Step 1/5] Downloading snapshot from CMS")
    await downloadSnapshot(gzPath)

    console.log("\n[Step 2/5] Decompressing")
    await decompress(gzPath, sqlPath)

    console.log("\n[Step 3/5] Preprocessing SQL")
    await preprocessSql(sqlPath, processedPath)

    console.log("\n[Step 4/5] Restoring database")
    await psqlRestore(db, processedPath)

    console.log("\n[Step 5/5] Recording timestamp")
    await recordTimestamp()
  } finally {
    console.log("\n[Cleanup] Removing temp files")
    await cleanup()
  }

  console.log("\n" + "\u2500".repeat(60))
  console.log("[data-import] Import completed successfully")
}

main().catch((err: unknown) => {
  console.error("[data-import] Fatal error:", err)
  process.exit(1)
})
