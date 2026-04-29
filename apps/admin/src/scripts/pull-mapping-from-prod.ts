#!/usr/bin/env tsx
/**
 * Download the prod admin coreId → cms-video-id mapping snapshot to
 * the local-fallback storage path so subsequent local workflow
 * invocations (run-embeds) can read it through the existing
 * `apps/admin/src/storage/s3.ts` `getObject` path with no code
 * changes.
 *
 * Usage:
 *   RAILWAY_S3_ACCESS_KEY_ID=... \
 *   RAILWAY_S3_SECRET_ACCESS_KEY=... \
 *   pnpm --filter @forge/admin pull:mapping
 *
 *   # Override defaults:
 *   pnpm --filter @forge/admin pull:mapping \
 *     --bucket=cms-storage-jbpuckp0lmqap \
 *     --key=admin-migrations/core-id-mapping.json \
 *     --endpoint=https://t3.storageapi.dev \
 *     --region=sjc \
 *     --out=apps/admin/.tmp/objects/admin-migrations/core-id-mapping.json
 *
 * Reads RAILWAY_S3_* directly from process.env (mirrors
 * refresh-core-id-mapping.ts) so the CLI runs without admin's full
 * env matrix populated. The downloaded bytes land at the
 * local-fallback path; storage/s3's `getObject` reads from there
 * when RAILWAY_S3_BUCKET is unset, which is the normal local-dev
 * shape.
 *
 * NOT run against prod write paths. Read-only download. The bucket
 * defaults to admin's prod bucket because that's where
 * `refresh:core-id-mapping` uploads the canonical snapshot — the
 * operator who refreshed it from cms PG most-recently is the source
 * of truth.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve as resolvePath } from "node:path"

import { DEFAULT_CORE_ID_MAPPING_S3_KEY } from "@/services/core-id-mapping.constants"

const DEFAULT_BUCKET = "cms-storage-jbpuckp0lmqap"
const DEFAULT_ENDPOINT = "https://t3.storageapi.dev"
const DEFAULT_REGION = "sjc"

function parseArg(name: string, fallback: string): string {
  const flag = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(flag))
  return arg ? arg.slice(flag.length) : fallback
}

export type PullMappingArgs = {
  bucket: string
  key: string
  endpoint: string
  region: string
  outPath: string
  accessKeyId: string
  secretAccessKey: string
}

export async function downloadMapping(args: PullMappingArgs): Promise<number> {
  const [{ S3Client, GetObjectCommand }, { NodeHttpHandler }] =
    await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@smithy/node-http-handler"),
    ])

  const s3 = new S3Client({
    endpoint: args.endpoint,
    region: args.region,
    credentials: {
      accessKeyId: args.accessKeyId,
      secretAccessKey: args.secretAccessKey,
    },
    forcePathStyle: true,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
    }),
  })

  const response = await s3.send(
    new GetObjectCommand({ Bucket: args.bucket, Key: args.key }),
  )
  if (!response.Body) {
    throw new Error(
      `S3 GET ${args.bucket}/${args.key} returned no Body (status ${response.$metadata.httpStatusCode ?? "unknown"})`,
    )
  }

  // `Body` is a `StreamingBlobPayloadOutputTypes` — the AWS SDK's
  // `transformToByteArray()` is the supported way to materialise it
  // without leaking the underlying transport type.
  const bytes = Buffer.from(
    await (
      response.Body as unknown as {
        transformToByteArray(): Promise<Uint8Array>
      }
    ).transformToByteArray(),
  )

  await mkdir(dirname(args.outPath), { recursive: true })
  await writeFile(args.outPath, bytes)
  return bytes.byteLength
}

export async function main(): Promise<void> {
  const bucket = parseArg("bucket", DEFAULT_BUCKET)
  const key = parseArg("key", DEFAULT_CORE_ID_MAPPING_S3_KEY)
  const endpoint = parseArg("endpoint", DEFAULT_ENDPOINT)
  const region = parseArg("region", DEFAULT_REGION)
  // Default output path resolves relative to the operator's CWD;
  // `pnpm --filter @forge/admin` runs the script from
  // `apps/admin`, so the default `.tmp/...` lands inside admin's
  // package directory — matching `apps/admin/src/storage/s3.ts`'s
  // local fallback layout.
  const outPath = resolvePath(
    process.cwd(),
    parseArg("out", join(".tmp", "objects", DEFAULT_CORE_ID_MAPPING_S3_KEY)),
  )

  const accessKeyId = process.env.RAILWAY_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.RAILWAY_S3_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    process.stderr.write(
      "[pull-mapping] RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY are required\n",
    )
    process.exit(2)
  }

  process.stdout.write(
    JSON.stringify({
      event: "pull-mapping.start",
      bucket,
      key,
      endpoint,
      region,
      outPath,
    }) + "\n",
  )

  const bytes = await downloadMapping({
    bucket,
    key,
    endpoint,
    region,
    outPath,
    accessKeyId,
    secretAccessKey,
  })

  process.stdout.write(
    JSON.stringify({
      event: "pull-mapping.complete",
      bucket,
      key,
      bytes,
      outPath,
    }) + "\n",
  )
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({
        event: "pull-mapping.fatal",
        error: err instanceof Error ? err.message : String(err),
      }) + "\n",
    )
    process.exit(1)
  })
}
