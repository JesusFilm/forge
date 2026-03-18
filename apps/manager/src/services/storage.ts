// Storage service — Railway S3-compatible Object Storage.
// Uses the same RAILWAY_S3_* env pattern as apps/cms (Strapi upload provider).

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3"
import { env } from "@/config/env"

let _s3: S3Client | undefined
function getS3(): S3Client {
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
  return _s3
}

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

export async function writeArtifact(
  options: WriteArtifactOptions,
): Promise<string> {
  const key = artifactKey(options.assetId, options.artifactType, options.ext)

  console.log(
    JSON.stringify({
      event: "storage_write_start",
      key,
      contentType: options.contentType,
    }),
  )

  await getS3().send(
    new PutObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
      Body: options.body,
      ContentType: options.contentType,
    }),
  )

  console.log(JSON.stringify({ event: "storage_write_complete", key }))

  return key
}

export async function readArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  const key = artifactKey(assetId, artifactType, ext)

  const response = await getS3().send(
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

export async function artifactExists(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<boolean> {
  const key = artifactKey(assetId, artifactType, ext)

  try {
    await getS3().send(
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
