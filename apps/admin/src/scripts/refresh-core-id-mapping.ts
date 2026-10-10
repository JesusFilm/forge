/**
 * Refresh the admin coreId → cms video id mapping snapshot.
 *
 * Dumps from cms via `pnpm --filter @forge/cms dump:core-id-mapping` and
 * uploads the resulting JSON to the shared Railway S3 bucket at
 * `admin-migrations/core-id-mapping.json`. That key is the default
 * consumed by transcript embedding backfills and future admin-migration
 * mutations.
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

// Import the constant from the standalone constants module — NOT from
// core-id-mapping.service.ts — so the CLI doesn't transitively pull in
// @/storage/s3 → @/config/env and trip the admin env validator
// (DATABASE_URL etc.) on operator-run invocations that only have the
// RAILWAY_S3_* vars populated.
import { DEFAULT_CORE_ID_MAPPING_S3_KEY } from "@/services/core-id-mapping.constants"

// Ceiling for the cms dump child. A healthy dump of the whole catalog takes
// seconds; anything over 10 minutes is almost certainly a wedge (DB hang,
// stale pnpm store lock) that an operator would rather see as a clear
// timeout than an indefinite stall. Override with DUMP_TIMEOUT_MS=<ms> for
// exceptional cases; a non-numeric override (e.g. the intuitive `10m`)
// falls back to the default and warns, so setTimeout doesn't collapse to
// ~1ms on `Number("10m") === NaN`.
export function parseTimeoutMs(raw: string | undefined): number {
  const fallback = 10 * 60 * 1000
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    process.stderr.write(
      `[refresh:core-id-mapping] ignoring non-numeric DUMP_TIMEOUT_MS=${JSON.stringify(raw)}; falling back to ${fallback}ms\n`,
    )
    return fallback
  }
  return parsed
}

const DUMP_TIMEOUT_MS = parseTimeoutMs(process.env.DUMP_TIMEOUT_MS)

export async function runDumpCommand(outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@forge/cms", "dump:core-id-mapping", "--out", outPath],
      { stdio: "inherit" },
    )

    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    // SIGKILL escalation timer is captured so cleanup() can cancel it when
    // the child exits cleanly in response to SIGTERM — otherwise the killer
    // fires at a dead pid (no-op but leaks a closure for 5s).
    let killTimer: NodeJS.Timeout | undefined

    const timeout = setTimeout(() => {
      settle(() => {
        child.kill("SIGTERM")
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000)
        killTimer.unref()
        cleanup()
        reject(
          new Error(`cms dump exceeded ${DUMP_TIMEOUT_MS}ms; sent SIGTERM`),
        )
      })
    }, DUMP_TIMEOUT_MS)
    timeout.unref()

    const forwardSignal = (signal: NodeJS.Signals) => {
      // Operator hit Ctrl-C — propagate so the child exits cleanly and
      // doesn't leak a DB connection to cms. With stdio:"inherit" the
      // terminal already delivers SIGINT to the whole foreground group, so
      // this is primarily for programmatic SIGTERM (Railway/orchestrator)
      // and for test environments where the child isn't terminal-bound.
      if (!child.killed) child.kill(signal)
    }
    process.once("SIGINT", forwardSignal)
    process.once("SIGTERM", forwardSignal)

    const cleanup = () => {
      clearTimeout(timeout)
      if (killTimer !== undefined) clearTimeout(killTimer)
      process.off("SIGINT", forwardSignal)
      process.off("SIGTERM", forwardSignal)
    }

    child.on("error", (err) => {
      settle(() => {
        cleanup()
        reject(err)
      })
    })
    child.on("exit", (code, signal) => {
      settle(() => {
        cleanup()
        if (code === 0) return resolve()
        reject(
          new Error(
            `cms dump exited with ${signal ? `signal ${signal}` : `code ${code ?? "null"}`}`,
          ),
        )
      })
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
    const localPath = join(
      process.cwd(),
      ".tmp",
      "objects",
      DEFAULT_CORE_ID_MAPPING_S3_KEY,
    )
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

  const [{ S3Client, PutObjectCommand }, { NodeHttpHandler }] =
    await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@smithy/node-http-handler"),
    ])
  const s3 = new S3Client({
    endpoint: RAILWAY_S3_ENDPOINT,
    region: RAILWAY_S3_REGION ?? "auto",
    credentials: {
      accessKeyId: RAILWAY_S3_ACCESS_KEY_ID,
      secretAccessKey: RAILWAY_S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    // Match the timeouts on storage/s3.ts's shared client so a stalled
    // Railway endpoint can't hang the operator CLI indefinitely.
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
    }),
  })

  await s3.send(
    new PutObjectCommand({
      Bucket: RAILWAY_S3_BUCKET,
      Key: DEFAULT_CORE_ID_MAPPING_S3_KEY,
      Body: bytes,
      ContentType: "application/json",
    }),
  )
}

export async function main(): Promise<void> {
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
      `[refresh:core-id-mapping] uploaded ${bytes.byteLength} bytes to s3 key ${DEFAULT_CORE_ID_MAPPING_S3_KEY}\n`,
    )
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch((err) => {
      // rm with force:true already swallows ENOENT; anything reaching here
      // is an unexpected condition (EACCES, EBUSY). Surface it so the
      // operator sees the leaked tmp dir — cleanup failure shouldn't mask
      // upload success but should at least be observable.
      process.stderr.write(
        `[refresh:core-id-mapping] warning: failed to clean tmp dir ${tmp}: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    })
  }
}

// Only run main() when this module is invoked directly (via tsx). Skip the
// side-effect when imported by tests so the test can exercise runDumpCommand
// without triggering the full CLI orchestration.
if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((err) => {
    process.stderr.write(
      `[refresh:core-id-mapping] failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    process.exit(1)
  })
}
