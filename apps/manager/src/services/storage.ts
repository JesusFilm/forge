// Storage service — Railway S3-compatible Object Storage with local tmp fallback.
// Uses Railway's RAILWAY_S3_* env pattern for artifact storage.
// When RAILWAY_S3_BUCKET is not set, artifacts are written to .tmp/artifacts/ locally.

import { env } from "@/config/env"
import { mkdir, readFile, writeFile, access, stat } from "node:fs/promises"
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

// ---------------------------------------------------------------------------
// Streaming reads (shorts media route — plan 2026-06-11-002 decision 6).
// readArtifact above buffers whole objects (fine for JSON/VTT, fatal for a
// 180–360MB MP4); these helpers stream and support byte ranges instead.
// ---------------------------------------------------------------------------

export class ArtifactNotFoundError extends Error {
  constructor(key: string) {
    super(`Artifact not found: ${key}`)
    this.name = "ArtifactNotFoundError"
  }
}

export class ArtifactRangeNotSatisfiableError extends Error {
  constructor(readonly totalSize: number) {
    super(`Requested range is not satisfiable (object size ${totalSize})`)
    this.name = "ArtifactRangeNotSatisfiableError"
  }
}

// Discriminated union: a range is EITHER offset-based or a suffix — the
// mutually-exclusive shapes are unrepresentable as one object, so consumers
// narrow with `"suffix" in range` instead of re-validating field combos.
export type ArtifactStreamRange =
  | {
      /** Inclusive start byte offset (bytes=a- / bytes=a-b). */
      start: number
      /** Inclusive end byte offset (bytes=a-b). */
      end?: number
    }
  | {
      /** Last-n-bytes suffix length (bytes=-n). */
      suffix: number
    }

export type ArtifactStat = {
  size: number
  etag?: string
  contentType?: string
}

export type ArtifactStream = {
  /** Web ReadableStream over exactly the requested byte window. */
  body: ReadableStream<Uint8Array>
  /** Byte count of THIS response body (end - start + 1). */
  contentLength: number
  /** Full object size. */
  totalSize: number
  /** Inclusive absolute offsets of the body within the object. */
  rangeStart: number
  rangeEnd: number
  etag?: string
  contentType?: string
}

// AWS S3 NoSuchKey classification (root CLAUDE.md): match the SDK v3 typed
// surface (error.name) FIRST, legacy error.Code second, fs ENOENT for the
// local backend, message regex as backstop only.
function isStorageNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }
  const candidate = error as {
    name?: unknown
    Code?: unknown
    code?: unknown
    message?: unknown
  }
  if (candidate.name === "NoSuchKey" || candidate.name === "NotFound") {
    return true
  }
  if (candidate.Code === "NoSuchKey" || candidate.Code === "NotFound") {
    return true
  }
  if (candidate.code === "ENOENT") {
    return true
  }
  return (
    typeof candidate.message === "string" &&
    /not found|does not exist|ENOENT/i.test(candidate.message)
  )
}

export async function statArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<ArtifactStat> {
  const key = artifactKey(assetId, artifactType, ext)

  if (useS3) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3")
    const s3 = await getS3()
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: env.RAILWAY_S3_BUCKET, Key: key }),
      )
      return {
        size: head.ContentLength ?? 0,
        etag: head.ETag ?? undefined,
        contentType: head.ContentType ?? undefined,
      }
    } catch (error) {
      if (isStorageNotFoundError(error)) {
        throw new ArtifactNotFoundError(key)
      }
      throw error
    }
  }

  try {
    const stats = await stat(localPath(key))
    return { size: stats.size }
  } catch (error) {
    if (isStorageNotFoundError(error)) {
      throw new ArtifactNotFoundError(key)
    }
    throw error
  }
}

// Type predicate so callers narrow `range` without a cast. With the
// discriminated union an "empty" range is unrepresentable, so presence of
// the value IS the request.
function hasRequestedRange(
  range: ArtifactStreamRange | undefined,
): range is ArtifactStreamRange {
  return range !== undefined
}

// Resolves a requested byte range against the object size. Throws
// ArtifactRangeNotSatisfiableError (carrying the size for the 416
// Content-Range header) when the window falls entirely outside the object.
function resolveRange(
  range: ArtifactStreamRange,
  size: number,
): { start: number; end: number } {
  if ("suffix" in range) {
    if (range.suffix <= 0 || size === 0) {
      throw new ArtifactRangeNotSatisfiableError(size)
    }
    return { start: Math.max(0, size - range.suffix), end: size - 1 }
  }

  const { start } = range
  if (start >= size) {
    throw new ArtifactRangeNotSatisfiableError(size)
  }
  const end = range.end === undefined ? size - 1 : Math.min(range.end, size - 1)
  if (end < start) {
    throw new ArtifactRangeNotSatisfiableError(size)
  }
  return { start, end }
}

// Streaming read: S3 GetObject with a Range header (web stream via
// transformToWebStream) or local createReadStream({start, end}). Never
// buffers the object. Deliberately separate from readArtifact (untouched).
export async function openArtifactStream(options: {
  assetId: string
  artifactType: string
  ext: string
  range?: ArtifactStreamRange
}): Promise<ArtifactStream> {
  const key = artifactKey(options.assetId, options.artifactType, options.ext)
  // Stat first (HEAD / fs.stat) so every path knows the full object size —
  // suffix ranges and 416 Content-Range headers need it, and validating the
  // window locally keeps the S3 Range request always absolute + in-bounds.
  const info = await statArtifact(
    options.assetId,
    options.artifactType,
    options.ext,
  )

  const requestedRange = options.range
  const ranged = hasRequestedRange(requestedRange)
  const resolved = ranged
    ? resolveRange(requestedRange, info.size)
    : { start: 0, end: Math.max(0, info.size - 1) }
  const contentLength = info.size === 0 ? 0 : resolved.end - resolved.start + 1

  if (useS3) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3")
    const s3 = await getS3()
    let response
    try {
      response = await s3.send(
        new GetObjectCommand({
          Bucket: env.RAILWAY_S3_BUCKET,
          Key: key,
          ...(ranged
            ? { Range: `bytes=${resolved.start}-${resolved.end}` }
            : {}),
        }),
      )
    } catch (error) {
      if (isStorageNotFoundError(error)) {
        throw new ArtifactNotFoundError(key)
      }
      throw error
    }
    if (!response.Body) {
      throw new Error(`S3 object body is empty for key: ${key}`)
    }
    return {
      body: response.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      contentLength,
      totalSize: info.size,
      rangeStart: resolved.start,
      rangeEnd: resolved.end,
      etag: response.ETag ?? info.etag,
      contentType: response.ContentType ?? info.contentType,
    }
  }

  const { createReadStream } = await import("node:fs")
  const { Readable } = await import("node:stream")
  const nodeStream =
    info.size === 0
      ? Readable.from([])
      : createReadStream(localPath(key), {
          start: resolved.start,
          end: resolved.end,
        })

  return {
    body: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
    contentLength,
    totalSize: info.size,
    rangeStart: resolved.start,
    rangeEnd: resolved.end,
  }
}

// Presigned GET URL for an artifact (smart-crop QA frames + Mux output
// ingestion). S3 mode only — the local fallback has no URL surface, so the
// caller must degrade (smart-crop marks the step skipped with reason
// "storage_presign_unavailable").
export async function createPresignedArtifactUrl(
  assetId: string,
  artifactType: string,
  ext: string,
  expiresInSeconds: number,
): Promise<string | null> {
  if (!useS3) {
    return null
  }

  const { GetObjectCommand } = await import("@aws-sdk/client-s3")
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner")
  const key = artifactKey(assetId, artifactType, ext)
  const s3 = await getS3()

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
    }),
    { expiresIn: expiresInSeconds },
  )
}
