/**
 * Refresh the admin coreId → cms video id mapping snapshot.
 *
 * Dumps from cms via `pnpm --filter @forge/cms dump:core-id-mapping` and
 * uploads the resulting JSON to the shared Railway S3 bucket at
 * `admin-migrations/core-id-mapping.json`. That key is the default
 * consumed by `triggerSceneEmbeddingBackfill` (and future admin-migration
 * mutations).
 *
 * Usage:
 *   pnpm --filter @forge/admin refresh:core-id-mapping
 *
 * Env:
 *   RAILWAY_S3_BUCKET, RAILWAY_S3_ENDPOINT, RAILWAY_S3_REGION,
 *   RAILWAY_S3_ACCESS_KEY_ID, RAILWAY_S3_SECRET_ACCESS_KEY must point
 *   at the shared bucket. Local fallback (no bucket) writes to
 *   `apps/admin/.tmp/objects/admin-migrations/core-id-mapping.json`.
 *
 * The cms dump inherits apps/cms/.env for its DATABASE_URL — point
 * that at prod cms when refreshing the prod snapshot.
 *
 * Reads env directly from process.env rather than @/config/env so the
 * CLI can run without admin's full env matrix populated (e.g. DATABASE_URL
 * is not required to upload a mapping file).
 */

import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const DEFAULT_S3_KEY = "admin-migrations/core-id-mapping.json"

async function runDumpCommand(outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@forge/cms", "dump:core-id-mapping", "--out", outPath],
      { stdio: "inherit" },
    )
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) return resolve()
      reject(
        new Error(
          `cms dump exited with code ${code ?? "null"} (signal-based exit)`,
        ),
      )
    })
  })
}

async function uploadToS3(bytes: Buffer): Promise<void> {
  const {
    RAILWAY_S3_BUCKET,
    RAILWAY_S3_ENDPOINT,
    RAILWAY_S3_REGION,
    RAILWAY_S3_ACCESS_KEY_ID,
    RAILWAY_S3_SECRET_ACCESS_KEY,
  } = process.env

  if (!RAILWAY_S3_BUCKET) {
    // Local fallback — mirrors storage/s3.ts's LOCAL_OBJECT_DIR layout so
    // dev runs can exercise the rest of the pipeline without real S3.
    const localPath = join(process.cwd(), ".tmp", "objects", DEFAULT_S3_KEY)
    await mkdir(dirname(localPath), { recursive: true })
    await writeFile(localPath, bytes)
    process.stdout.write(
      `[refresh:core-id-mapping] RAILWAY_S3_BUCKET not set; wrote local fallback to ${localPath}\n`,
    )
    return
  }

  if (!RAILWAY_S3_ACCESS_KEY_ID || !RAILWAY_S3_SECRET_ACCESS_KEY) {
    throw new Error(
      "RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY are required when RAILWAY_S3_BUCKET is set",
    )
  }

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3")
  const s3 = new S3Client({
    endpoint: RAILWAY_S3_ENDPOINT,
    region: RAILWAY_S3_REGION ?? "auto",
    credentials: {
      accessKeyId: RAILWAY_S3_ACCESS_KEY_ID,
      secretAccessKey: RAILWAY_S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  })

  await s3.send(
    new PutObjectCommand({
      Bucket: RAILWAY_S3_BUCKET,
      Key: DEFAULT_S3_KEY,
      Body: bytes,
      ContentType: "application/json",
    }),
  )
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "refresh-core-id-mapping-"))
  const outPath = join(tmp, "core-id-mapping.json")

  try {
    process.stdout.write(
      `[refresh:core-id-mapping] dumping mapping from cms → ${outPath}\n`,
    )
    await runDumpCommand(outPath)

    const bytes = await readFile(outPath)
    await uploadToS3(bytes)

    process.stdout.write(
      `[refresh:core-id-mapping] uploaded ${bytes.byteLength} bytes to s3 key ${DEFAULT_S3_KEY}\n`,
    )
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  process.stderr.write(
    `[refresh:core-id-mapping] failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  )
  process.exit(1)
})
