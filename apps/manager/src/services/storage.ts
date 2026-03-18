// Storage service — Railway S3-compatible Object Storage with local tmp fallback.
// Uses the same RAILWAY_S3_* env pattern as apps/cms (Strapi upload provider).
// When RAILWAY_S3_BUCKET is not set, artifacts are written to .tmp/artifacts/ locally.

import { env } from "@/config/env"
import { mkdir, readFile, writeFile, access } from "node:fs/promises"
import { join } from "node:path"

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
  // artifactType may contain hyphens (e.g., "translation-es")
  if (!/^[a-zA-Z0-9_-]+$/.test(artifactType)) {
    throw new Error("Invalid artifactType")
  }
  return `${assetId}/${artifactType}.${ext}`
}

// ---------------------------------------------------------------------------
// S3 backend (production)
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

    // Double-check after await to avoid duplicate clients under concurrency
    if (!_s3) {
      _s3 = new S3Client({
        endpoint: env.RAILWAY_S3_ENDPOINT,
        region: env.RAILWAY_S3_REGION,
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

async function s3Write(options: WriteArtifactOptions): Promise<string> {
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

  return key
}

async function s3Read(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3")
  const key = artifactKey(assetId, artifactType, ext)
  const s3 = await getS3()

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
    }),
  )

  if (!response.Body) {
    throw new Error(`S3 object body is empty for key: ${key}`)
  }
  return response.Body.transformToByteArray()
}

async function s3Exists(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<boolean> {
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3")
  const key = artifactKey(assetId, artifactType, ext)
  const s3 = await getS3()

  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: env.RAILWAY_S3_BUCKET,
        Key: key,
      }),
    )
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Local tmp backend (dev / test)
// ---------------------------------------------------------------------------

const LOCAL_ROOT = join(process.cwd(), ".tmp", "artifacts")

function localPath(key: string): string {
  return join(LOCAL_ROOT, key)
}

async function localWrite(options: WriteArtifactOptions): Promise<string> {
  const key = artifactKey(options.assetId, options.artifactType, options.ext)
  const filePath = localPath(key)
  await mkdir(join(filePath, ".."), { recursive: true })
  await writeFile(filePath, options.body)
  return key
}

async function localRead(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  const key = artifactKey(assetId, artifactType, ext)
  return new Uint8Array(await readFile(localPath(key)))
}

async function localExists(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<boolean> {
  const key = artifactKey(assetId, artifactType, ext)
  try {
    await access(localPath(key))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Public API — delegates to S3 or local based on RAILWAY_S3_BUCKET presence
// ---------------------------------------------------------------------------

export async function writeArtifact(
  options: WriteArtifactOptions,
): Promise<string> {
  const key = artifactKey(options.assetId, options.artifactType, options.ext)

  console.log(
    JSON.stringify({
      event: "storage_write_start",
      key,
      backend: useS3 ? "s3" : "local",
      contentType: options.contentType,
    }),
  )

  const result = useS3 ? await s3Write(options) : await localWrite(options)

  console.log(
    JSON.stringify({
      event: "storage_write_complete",
      key,
      backend: useS3 ? "s3" : "local",
    }),
  )

  return result
}

export async function readArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  return useS3
    ? s3Read(assetId, artifactType, ext)
    : localRead(assetId, artifactType, ext)
}

export async function artifactExists(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<boolean> {
  return useS3
    ? s3Exists(assetId, artifactType, ext)
    : localExists(assetId, artifactType, ext)
}
