/**
 * Lazy singleton S3 client for snapshot operations.
 * Reuses the same RAILWAY_S3_* env vars as the Strapi upload provider.
 *
 * @see docs/solutions/platform/optional-railway-s3-local-fallback.md
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

let client: S3Client | null = null

function getS3Client(): S3Client {
  if (client) return client

  const endpoint = process.env.RAILWAY_S3_ENDPOINT
  const accessKeyId = process.env.RAILWAY_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.RAILWAY_S3_SECRET_ACCESS_KEY

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing RAILWAY_S3_ENDPOINT, RAILWAY_S3_ACCESS_KEY_ID, or RAILWAY_S3_SECRET_ACCESS_KEY",
    )
  }

  client = new S3Client({
    endpoint,
    region: process.env.RAILWAY_S3_REGION ?? "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
  return client
}

function getBucket(): string {
  const bucket = process.env.RAILWAY_S3_BUCKET
  if (!bucket) throw new Error("Missing RAILWAY_S3_BUCKET")
  return bucket
}

export async function uploadSnapshot(key: string, body: Buffer): Promise<void> {
  const s3 = getS3Client()
  await s3.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: "application/gzip",
    }),
  )
}

export async function getSnapshotPresignedUrl(
  key: string,
  expiresIn = 900,
): Promise<string> {
  const s3 = getS3Client()
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn },
  )
}

export async function listSnapshots(
  prefix: string,
): Promise<{ key: string; lastModified: Date }[]> {
  const s3 = getS3Client()
  const result = await s3.send(
    new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix }),
  )

  return (result.Contents ?? [])
    .filter((obj) => obj.Key && obj.LastModified)
    .map((obj) => ({ key: obj.Key!, lastModified: obj.LastModified! }))
    .sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime())
}

export async function deleteSnapshot(key: string): Promise<void> {
  const s3 = getS3Client()
  await s3.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }))
}
