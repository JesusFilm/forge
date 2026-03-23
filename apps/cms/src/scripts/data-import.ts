/**
 * CMS Data Import
 *
 * Downloads the nightly production database backup from Railway S3 and restores
 * it into the local/staging PostgreSQL instance. Replaces the gateway sync for
 * non-production environments.
 *
 * Usage:
 *   pnpm data-import
 *
 * Required env vars:
 *   DATABASE_URL                  — PostgreSQL connection string
 *   RAILWAY_S3_ENDPOINT           — S3-compatible endpoint
 *   RAILWAY_S3_REGION             — S3 region (default: "auto")
 *   RAILWAY_S3_BUCKET             — S3 bucket name
 *   RAILWAY_S3_ACCESS_KEY_ID      — S3 access key
 *   RAILWAY_S3_SECRET_ACCESS_KEY  — S3 secret key
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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BACKUP_KEY = "backups/cms-backup.sql.gz"
const IMPORTS_DIR = "./imports"

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function assertNotProduction(): void {
  const nodeEnv = process.env["NODE_ENV"]
  if (nodeEnv === "production") {
    throw new Error(
      "Refusing to run data-import with NODE_ENV=production. " +
        "This script runs DROP SCHEMA CASCADE and is only safe for dev/staging.",
    )
  }
}

// ---------------------------------------------------------------------------
// S3 Download
// ---------------------------------------------------------------------------

async function downloadBackup(destPath: string): Promise<void> {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3")

  const s3 = new S3Client({
    endpoint: requiredEnv("RAILWAY_S3_ENDPOINT"),
    region: process.env["RAILWAY_S3_REGION"] ?? "auto",
    credentials: {
      accessKeyId: requiredEnv("RAILWAY_S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("RAILWAY_S3_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  })

  const bucket = requiredEnv("RAILWAY_S3_BUCKET")

  console.log(`[data-import] Downloading s3://${bucket}/${BACKUP_KEY}`)
  const startTime = Date.now()

  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: BACKUP_KEY }),
  )

  if (!response.Body) {
    throw new Error("S3 response body is empty")
  }

  const contentLength = response.ContentLength ?? 0
  let bytesReceived = 0

  // Progress tracking transform
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

  const bodyStream =
    response.Body instanceof Readable
      ? response.Body
      : Readable.fromWeb(response.Body as ReadableStream)

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
  console.log(`[data-import] Decompressing ${gzPath}`)
  const startTime = Date.now()

  const gunzip = createGunzip()
  const source = createReadStream(gzPath)
  const dest = createWriteStream(outPath)

  await pipeline(source, gunzip, dest)

  const gzSize = (await stat(gzPath)).size
  const rawSize = (await stat(outPath)).size
  const ratio = rawSize > 0 ? ((gzSize / rawSize) * 100).toFixed(1) : "N/A"
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log(
    `[data-import] Decompressed: ${formatBytes(gzSize)} → ${formatBytes(rawSize)} (${ratio}% compression ratio) in ${elapsed}s`,
  )
}

// ---------------------------------------------------------------------------
// Preprocess SQL
// ---------------------------------------------------------------------------

async function preprocessSql(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  console.log(`[data-import] Preprocessing SQL`)
  const startTime = Date.now()

  const input = createReadStream(inputPath, { encoding: "utf-8" })
  const output = createWriteStream(outputPath, { encoding: "utf-8" })
  const rl = createInterface({ input, crlfDelay: Infinity })

  // Prepend DROP/CREATE SCHEMA inside the file so that --single-transaction
  // wraps everything atomically. If the restore fails, the DROP rolls back too.
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

  // Wait for output to finish flushing
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
  console.log(`[data-import] Restoring: ${sqlPath}`)

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
        console.log(`[data-import] Restore complete`)
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

const TIMESTAMP_FILE = "./imports/.last-import"

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
    `${IMPORTS_DIR}/cms-backup.sql.gz`,
    `${IMPORTS_DIR}/cms-backup.sql`,
    `${IMPORTS_DIR}/cms-backup-processed.sql`,
  ]

  for (const file of files) {
    try {
      await rm(file, { force: true })
    } catch {
      // ignore missing files
    }
  }

  console.log(`[data-import] Temp files cleaned up`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  assertNotProduction()

  console.log("[data-import] Starting CMS database import")
  console.log("─".repeat(60))

  const lastImport = await getLastImport()
  if (lastImport) {
    console.log(`[data-import] Last import: ${lastImport}`)
  }

  const databaseUrl = requiredEnv("DATABASE_URL")
  const db = parseConnectionString(databaseUrl)

  console.log(
    `[data-import] Target database: ${db.host}:${db.port}/${db.database}`,
  )
  console.log("─".repeat(60))

  // Ensure imports directory exists
  await mkdir(IMPORTS_DIR, { recursive: true })

  const gzPath = `${IMPORTS_DIR}/cms-backup.sql.gz`
  const sqlPath = `${IMPORTS_DIR}/cms-backup.sql`
  const processedPath = `${IMPORTS_DIR}/cms-backup-processed.sql`

  try {
    // Step 1: Download
    console.log("\n[Step 1/5] Downloading backup from S3")
    await downloadBackup(gzPath)

    // Step 2: Decompress
    console.log("\n[Step 2/5] Decompressing")
    await decompress(gzPath, sqlPath)

    // Step 3: Preprocess
    console.log("\n[Step 3/5] Preprocessing SQL")
    await preprocessSql(sqlPath, processedPath)

    // Step 4: Restore
    console.log("\n[Step 4/5] Restoring database")
    await psqlRestore(db, processedPath)

    // Step 5: Record timestamp
    console.log("\n[Step 5/5] Recording timestamp")
    await recordTimestamp()
  } finally {
    // Always clean up temp files
    console.log("\n[Cleanup] Removing temp files")
    await cleanup()
  }

  console.log("\n" + "─".repeat(60))
  console.log("[data-import] Import completed successfully")
}

main().catch((err: unknown) => {
  console.error("[data-import] Fatal error:", err)
  process.exit(1)
})
