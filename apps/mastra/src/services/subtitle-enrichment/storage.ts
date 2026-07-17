import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { env } from "../../config/env"

export type WriteSubtitleArtifactOptions = {
  assetId: string
  artifactType: string
  ext: string
  body: Buffer | Uint8Array | string
  contentType?: string
}

const SAFE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/
const LOCAL_ROOT = join(process.cwd(), ".tmp", "artifacts")

function validateKeyComponent(value: string, name: string): void {
  if (!SAFE_KEY_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: must contain only alphanumeric characters, hyphens, and underscores`,
    )
  }
}

export function subtitleArtifactKey(
  assetId: string,
  artifactType: string,
  ext: string,
): string {
  validateKeyComponent(assetId, "assetId")
  validateKeyComponent(ext, "ext")
  if (!SAFE_KEY_PATTERN.test(artifactType)) {
    throw new Error("Invalid artifactType")
  }
  return `${assetId}/${artifactType}.${ext}`
}

function useS3() {
  return Boolean(env.RAILWAY_S3_BUCKET)
}

export function isSubtitleArtifactStorageProductionReady(): boolean {
  if (env.NODE_ENV !== "production") return true
  return Boolean(
    env.RAILWAY_S3_BUCKET &&
    env.RAILWAY_S3_ACCESS_KEY_ID &&
    env.RAILWAY_S3_SECRET_ACCESS_KEY,
  )
}

let s3Client: InstanceType<
  typeof import("@aws-sdk/client-s3").S3Client
> | null = null

async function getS3() {
  if (!s3Client) {
    if (!env.RAILWAY_S3_ACCESS_KEY_ID || !env.RAILWAY_S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY are required when RAILWAY_S3_BUCKET is set",
      )
    }

    const { S3Client } = await import("@aws-sdk/client-s3")
    s3Client = new S3Client({
      endpoint: env.RAILWAY_S3_ENDPOINT,
      region: env.RAILWAY_S3_REGION,
      credentials: {
        accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID,
        secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    })
  }
  return s3Client
}

async function s3Write(options: WriteSubtitleArtifactOptions): Promise<string> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3")
  const key = subtitleArtifactKey(
    options.assetId,
    options.artifactType,
    options.ext,
  )
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
  const key = subtitleArtifactKey(assetId, artifactType, ext)
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

function localPath(key: string): string {
  return join(LOCAL_ROOT, key)
}

async function localWrite(
  options: WriteSubtitleArtifactOptions,
): Promise<string> {
  const key = subtitleArtifactKey(
    options.assetId,
    options.artifactType,
    options.ext,
  )
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
  const key = subtitleArtifactKey(assetId, artifactType, ext)
  return new Uint8Array(await readFile(localPath(key)))
}

export async function writeSubtitleArtifact(
  options: WriteSubtitleArtifactOptions,
): Promise<string> {
  return useS3() ? s3Write(options) : localWrite(options)
}

export async function readSubtitleArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  return useS3()
    ? s3Read(assetId, artifactType, ext)
    : localRead(assetId, artifactType, ext)
}

export const _internals = {
  SAFE_KEY_PATTERN,
  useS3,
  LOCAL_ROOT,
}
