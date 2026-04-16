// Storage service — Railway S3-compatible Object Storage with local tmp fallback.
//
// Mirrors apps/manager/src/services/storage.ts:
//   - Lazy `_s3` singleton
//   - `SAFE_KEY_PATTERN` validation
//   - Structured JSON logging
//   - Local fallback when RAILWAY_S3_BUCKET is not set
//
// Per Unit 11 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { env } from "@/config/env"

const useS3 = Boolean(env.RAILWAY_S3_BUCKET)

export type WriteArtifactOptions = {
  assetId: string
  artifactType: string
  ext: string
  body: Buffer | Uint8Array | string
  contentType?: string
}

const SAFE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

function validateKeyComponent(value: string, name: string): void {
  if (!SAFE_KEY_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: must contain only alphanumeric characters, hyphens, and underscores`,
    )
  }
}

function artifactKey(
  assetId: string,
  artifactType: string,
  ext: string,
): string {
  validateKeyComponent(assetId, "assetId")
  validateKeyComponent(ext, "ext")
  if (!/^[a-zA-Z0-9_-]+$/.test(artifactType)) {
    throw new Error("Invalid artifactType")
  }
  return `${assetId}/${artifactType}.${ext}`
}

// ---------------------------------------------------------------------------
// S3 backend
// ---------------------------------------------------------------------------

let _s3: InstanceType<typeof import("@aws-sdk/client-s3").S3Client> | undefined

async function getS3() {
  if (!_s3) {
    if (!env.RAILWAY_S3_ACCESS_KEY_ID || !env.RAILWAY_S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY are required when RAILWAY_S3_BUCKET is set",
      )
    }
    const { S3Client } = await import("@aws-sdk/client-s3")
    if (!_s3) {
      _s3 = new S3Client({
        endpoint: env.RAILWAY_S3_ENDPOINT,
        region: env.RAILWAY_S3_REGION ?? "auto",
        credentials: {
          accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID,
          secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      })
    }
  }
  return _s3
}

// ---------------------------------------------------------------------------
// Local fallback
// ---------------------------------------------------------------------------

const LOCAL_DIR = join(process.cwd(), ".tmp", "artifacts")

async function localWrite(options: WriteArtifactOptions): Promise<string> {
  const key = artifactKey(options.assetId, options.artifactType, options.ext)
  const dir = join(LOCAL_DIR, options.assetId)
  await mkdir(dir, { recursive: true })
  const filePath = join(LOCAL_DIR, key)
  await writeFile(filePath, options.body)
  return key
}

async function localRead(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  const key = artifactKey(assetId, artifactType, ext)
  return readFile(join(LOCAL_DIR, key))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function writeArtifact(
  options: WriteArtifactOptions,
): Promise<string> {
  if (!useS3) return localWrite(options)

  const { PutObjectCommand } = await import("@aws-sdk/client-s3")
  const key = artifactKey(options.assetId, options.artifactType, options.ext)
  const s3 = await getS3()

  await s3.send(
    new PutObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
      Body: options.body,
      ContentType: options.contentType,
    }),
  )

  console.log(
    JSON.stringify({
      event: "storage.write",
      key,
      backend: "s3",
      service: "forge-admin",
    }),
  )
  return key
}

export async function readArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  if (!useS3) return localRead(assetId, artifactType, ext)

  const { GetObjectCommand } = await import("@aws-sdk/client-s3")
  const key = artifactKey(assetId, artifactType, ext)
  const s3 = await getS3()

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
    }),
  )

  if (!response.Body) throw new Error(`Empty body for ${key}`)
  return new Uint8Array(await response.Body.transformToByteArray())
}
