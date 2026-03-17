// Storage service — Railway S3-compatible Object Storage.
// Uses the same RAILWAY_S3_* env pattern as apps/cms (Strapi upload provider).

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3"
import { env } from "@/config/env"

const s3 = new S3Client({
  endpoint: env.RAILWAY_S3_ENDPOINT,
  region: env.RAILWAY_S3_REGION,
  credentials: {
    accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID,
    secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

export type WriteArtifactOptions = {
  assetId: string
  artifactType: string
  ext: string
  body: Buffer | Uint8Array | string
  contentType?: string
}

function artifactKey(
  assetId: string,
  artifactType: string,
  ext: string,
): string {
  return `${assetId}/${artifactType}.${ext}`
}

export async function writeArtifact(
  options: WriteArtifactOptions,
): Promise<string> {
  const key = artifactKey(options.assetId, options.artifactType, options.ext)

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

export async function readArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  const key = artifactKey(assetId, artifactType, ext)

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
    }),
  )

  return response.Body!.transformToByteArray()
}

export async function artifactExists(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<boolean> {
  const key = artifactKey(assetId, artifactType, ext)

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
