import { timingSafeEqual } from "node:crypto"
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { env } from "@/config/env"
import {
  discoverVideoDbBackupFreshnessFromPages,
  type VideoDbBackupFreshness,
  type VideoDbBackupProfile,
  VIDEO_DB_BACKUP_PROFILES,
} from "@/scripts/video-db-backup-core"

export const runtime = "nodejs"

const BACKUP_PREFIX = "admin-video-db-backups"
const SIGNED_URL_TTL_SECONDS = 10 * 60
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 })
}

function tooManyRequests(): Response {
  return Response.json({ error: "Too many requests" }, { status: 429 })
}

function serviceUnavailable(error: string): Response {
  return Response.json({ error }, { status: 503 })
}

function methodNotAllowed(): Response {
  return Response.json(
    { error: "Method Not Allowed" },
    { status: 405, headers: { Allow: "POST" } },
  )
}

function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null

  const [scheme, token] = header.split(" ")
  if (scheme?.toLowerCase() !== "bearer" || !token) return null
  return token
}

function tokenMatches(token: string, secret: string): boolean {
  const tokenBuffer = Buffer.from(token)
  const secretBuffer = Buffer.from(secret)
  return (
    tokenBuffer.length === secretBuffer.length &&
    timingSafeEqual(tokenBuffer, secretBuffer)
  )
}

function configuredTokens(): string[] {
  if (!env.BACKUP_DOWNLOAD_API_KEYS) return []
  return env.BACKUP_DOWNLOAD_API_KEYS.split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function isAuthorized(request: Request): boolean {
  const token = getBearerToken(request)
  if (!token) return false

  let matched = false
  for (const configured of configuredTokens()) {
    matched = tokenMatches(token, configured) || matched
  }
  return matched
}

function parseProfile(value: unknown): VideoDbBackupProfile | null {
  if (typeof value !== "string") return null
  if (value in VIDEO_DB_BACKUP_PROFILES) return value as VideoDbBackupProfile
  return null
}

function requireS3Config(): {
  bucket: string
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
} {
  if (!env.RAILWAY_S3_BUCKET) {
    throw new Error("RAILWAY_S3_BUCKET is required")
  }
  if (!env.RAILWAY_S3_ACCESS_KEY_ID || !env.RAILWAY_S3_SECRET_ACCESS_KEY) {
    throw new Error(
      "RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY are required",
    )
  }

  return {
    bucket: env.RAILWAY_S3_BUCKET,
    endpoint: env.RAILWAY_S3_ENDPOINT,
    region: env.RAILWAY_S3_REGION ?? "auto",
    accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID,
    secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY,
  }
}

function createS3Client(config: ReturnType<typeof requireS3Config>): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  })
}

async function discoverLatestBackupFreshness(
  s3: S3Client,
  bucket: string,
  profile: VideoDbBackupProfile,
): Promise<VideoDbBackupFreshness> {
  const prefix = `${BACKUP_PREFIX}/${profile}/`
  return discoverVideoDbBackupFreshnessFromPages(async (continuationToken) => {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )
    return {
      objects: (response.Contents ?? []).map((object) => ({
        key: object.Key ?? "",
        size: object.Size,
        lastModified: object.LastModified,
      })),
      isTruncated: response.IsTruncated,
      nextContinuationToken: response.NextContinuationToken,
    }
  })
}

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "video-db-backup-presign",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()
  if (!isAuthorized(request)) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest("invalid-json")
  }

  const profile = parseProfile(
    body && typeof body === "object"
      ? (body as { profile?: unknown }).profile
      : null,
  )
  if (!profile) return badRequest("invalid-profile")

  let config: ReturnType<typeof requireS3Config>
  try {
    config = requireS3Config()
  } catch {
    return serviceUnavailable("backup-storage-not-configured")
  }

  const s3 = createS3Client(config)
  try {
    const freshness = await discoverLatestBackupFreshness(
      s3,
      config.bucket,
      profile,
    )
    if (freshness.status === "not-found") {
      return Response.json(
        { error: "backup-not-found", profile, freshness },
        { status: 404 },
      )
    }
    if (freshness.status === "unavailable-metadata") {
      return Response.json(
        { error: "backup-freshness-unavailable", profile, freshness },
        { status: 503 },
      )
    }

    const expiresAt = new Date(
      Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    ).toISOString()
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: freshness.key,
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    )

    console.info(
      JSON.stringify({
        event: "video-db.backup.presigned",
        profile,
        key: freshness.key,
        freshness: freshness.status,
        evaluatedAt: freshness.evaluatedAt,
        expiresAt,
      }),
    )

    return Response.json({
      url,
      profile,
      key: freshness.key,
      expiresAt,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      size: freshness.size,
      lastModified: freshness.lastModified,
      freshness,
    })
  } catch {
    return serviceUnavailable("backup-storage-unavailable")
  } finally {
    s3.destroy()
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowed()
}
