// Artifact storage — Railway S3-compatible Object Storage with local
// fallback. Mirrors apps/crop-worker/src/storage.ts: key scheme
// {assetId}/{artifactType}.{ext}, S3 mode toggled by RAILWAY_S3_BUCKET,
// local fallback for dev/test (SHORTS_WORKER_LOCAL_ARTIFACTS_DIR).

import { createHash } from "node:crypto"
import { constants, createReadStream, createWriteStream } from "node:fs"
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { env } from "./config/env.js"
import { WorkerError } from "./errors.js"

export class ArtifactNotFoundError extends WorkerError {
  constructor(key: string) {
    super(`artifact not found: ${key}`, "artifact_missing", false)
    this.name = "ArtifactNotFoundError"
  }
}

export class ArtifactRangeNotSatisfiableError extends WorkerError {
  constructor(readonly totalSize: number) {
    super("artifact byte range is not satisfiable", "invalid_range", false)
    this.name = "ArtifactRangeNotSatisfiableError"
  }
}

export class ArtifactIntegrityError extends WorkerError {
  constructor(message: string) {
    super(message, "artifact_integrity_failed", false)
    this.name = "ArtifactIntegrityError"
  }
}

export class ArtifactConflictError extends WorkerError {
  constructor(key: string) {
    super(`immutable artifact conflict: ${key}`, "artifact_conflict", false)
    this.name = "ArtifactConflictError"
  }
}

export type ArtifactReadStream = {
  stream: Readable
  contentLength: number
  contentRange?: string
}

export type DevotionalAttemptIdentity = {
  workspaceGeneration: number
  attemptId: string
  runId: string
}

export type WorkspaceArtifactRef = {
  schemaVersion: "2"
  key: string
  digest: string
  size: number
  contentType: string
  attempt: DevotionalAttemptIdentity
}

export type WriteWorkspaceArtifactOptions = {
  key: string
  body: Buffer | Uint8Array | string
  digest: string
  size: number
  contentType: string
  attempt: DevotionalAttemptIdentity
}

// AWS S3 NoSuchKey classification (root CLAUDE.md): match the typed SDK v3
// surface (error.name) FIRST, legacy error.Code second, message regex as
// backstop only. Never branch on the message alone.
export function isNoSuchKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error == null) return false
  const candidate = error as {
    name?: unknown
    Code?: unknown
    message?: unknown
  }
  if (candidate.name === "NoSuchKey" || candidate.name === "NotFound") {
    return true
  }
  if (candidate.Code === "NoSuchKey" || candidate.Code === "NotFound") {
    return true
  }
  const message = typeof candidate.message === "string" ? candidate.message : ""
  return /not found|does not exist|ENOENT/i.test(message)
}

export type WriteArtifactOptions = {
  assetId: string
  artifactType: string
  ext: string
  body: Buffer | Uint8Array | string
  contentType?: string
}

export type StorageConfig = {
  s3?: {
    endpoint?: string
    region?: string
    bucket: string
    accessKeyId?: string
    secretAccessKey?: string
    forcePathStyle?: boolean
    workspacePrefix?: string
  }
  localRootDir: string
}

export type Storage = {
  backend: "s3" | "local"
  writeArtifact(options: WriteArtifactOptions): Promise<string>
  writeArtifactFromFile(
    assetId: string,
    artifactType: string,
    ext: string,
    filePath: string,
    contentType: string,
  ): Promise<string>
  readArtifact(
    assetId: string,
    artifactType: string,
    ext: string,
  ): Promise<Uint8Array>
  /**
   * Streams an artifact to a local file (no whole-object buffering — the
   * clip MP4 a render downloads can be hundreds of MB). Throws
   * ArtifactNotFoundError when the key does not exist.
   */
  readArtifactToFile(
    assetId: string,
    artifactType: string,
    ext: string,
    destinationPath: string,
  ): Promise<void>
  artifactExists(
    assetId: string,
    artifactType: string,
    ext: string,
  ): Promise<boolean>
  readArtifactStream(
    assetId: string,
    artifactType: string,
    ext: string,
    range?: string,
  ): Promise<ArtifactReadStream>
  deleteArtifact(
    assetId: string,
    artifactType: string,
    ext: string,
  ): Promise<void>
  writeWorkspaceArtifact(
    options: WriteWorkspaceArtifactOptions,
  ): Promise<WorkspaceArtifactRef>
  writeWorkspaceArtifactFromFile(
    options: Omit<WriteWorkspaceArtifactOptions, "body"> & {
      filePath: string
    },
  ): Promise<WorkspaceArtifactRef>
  readWorkspaceArtifact(ref: WorkspaceArtifactRef): Promise<Uint8Array>
  readWorkspaceArtifactToFile(
    ref: WorkspaceArtifactRef,
    destinationPath: string,
  ): Promise<void>
  verifyWorkspaceArtifact(ref: WorkspaceArtifactRef): Promise<void>
  readWorkspaceArtifactStream(
    ref: WorkspaceArtifactRef,
    range?: string,
  ): Promise<ArtifactReadStream>
  workspaceArtifactExists(key: string): Promise<boolean>
  readWorkspaceManifest(
    attempt: DevotionalAttemptIdentity,
    area: "run-input" | "attempt-output",
  ): Promise<{ ref: WorkspaceArtifactRef; body: Uint8Array } | null>
}

const SAFE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const WORKSPACE_KEY_PATTERN = /^[a-zA-Z0-9._/-]+$/
const WORKSPACE_RUN_KEY_PATTERN =
  /^runs\/g\d+\/[a-f0-9]{24}\/(run-input|attempt-output)\/[a-f0-9]{64}\/[a-zA-Z0-9._-]+$/
const WORKSPACE_MANIFEST_KEY_PATTERN =
  /^runs\/g\d+\/[a-f0-9]{24}\/(run-input|attempt-output)\/manifest\.json$/
const SOURCE_MEDIA_KEY_PATTERN =
  /^source-media\/[a-zA-Z0-9._/-]+\.(mp4|mp3|m4a|wav|webm)$/

const CONTENT_TYPES_BY_EXTENSION: Record<string, readonly string[]> = {
  json: ["application/json"],
  mp4: ["video/mp4"],
  mp3: ["audio/mpeg", "audio/mp3"],
  m4a: ["audio/mp4"],
  wav: ["audio/wav", "audio/x-wav"],
  webm: ["video/webm"],
}
const WORKSPACE_SHA256_METADATA_KEY = "forge-sha256"

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  )
}

function isPreconditionFailed(error: unknown): boolean {
  if (typeof error !== "object" || error == null) return false
  const candidate = error as {
    name?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  return (
    candidate.name === "PreconditionFailed" ||
    candidate.$metadata?.httpStatusCode === 412
  )
}

function assertAttemptIdentity(identity: DevotionalAttemptIdentity): void {
  if (
    !Number.isSafeInteger(identity.workspaceGeneration) ||
    identity.workspaceGeneration <= 0 ||
    !SAFE_KEY_PATTERN.test(identity.attemptId) ||
    !SAFE_KEY_PATTERN.test(identity.runId) ||
    identity.attemptId.length > 128 ||
    identity.runId.length > 128
  ) {
    throw new ArtifactIntegrityError("invalid devotional attempt identity")
  }
}

export function devotionalAttemptToken(attemptId: string): string {
  if (!SAFE_KEY_PATTERN.test(attemptId) || attemptId.length > 128) {
    throw new ArtifactIntegrityError("invalid devotional attempt id")
  }
  return createHash("sha256").update(attemptId).digest("hex").slice(0, 24)
}

export function devotionalAttemptRoot(
  identity: DevotionalAttemptIdentity,
): string {
  assertAttemptIdentity(identity)
  return `runs/g${identity.workspaceGeneration}/${devotionalAttemptToken(identity.attemptId)}`
}

export function devotionalWorkspaceKey(
  identity: DevotionalAttemptIdentity,
  area: "run-input" | "attempt-output",
  digest: string,
  fileName: string,
): string {
  if (!SHA256_PATTERN.test(digest) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    throw new ArtifactIntegrityError("invalid devotional Workspace key input")
  }
  return `${devotionalAttemptRoot(identity)}/${area}/${digest}/${fileName}`
}

export function devotionalManifestKey(
  identity: DevotionalAttemptIdentity,
  area: "run-input" | "attempt-output",
): string {
  return `${devotionalAttemptRoot(identity)}/${area}/manifest.json`
}

export type DevotionalWorkspaceAssetId = {
  kind: "input" | "output"
  workspaceGeneration: number
  attemptToken: string
  manifestDigest: string
  manifestSize: number
}

export function devotionalWorkspaceAssetId(
  value: DevotionalWorkspaceAssetId,
): string {
  if (
    !Number.isSafeInteger(value.workspaceGeneration) ||
    value.workspaceGeneration <= 0 ||
    !/^[a-f0-9]{24}$/.test(value.attemptToken) ||
    !SHA256_PATTERN.test(value.manifestDigest) ||
    !Number.isSafeInteger(value.manifestSize) ||
    value.manifestSize <= 0
  ) {
    throw new ArtifactIntegrityError("invalid devotional Workspace asset id")
  }
  const prefix = value.kind === "input" ? "dv2i" : "dv2o"
  return `${prefix}_g${value.workspaceGeneration}_${value.attemptToken}_${value.manifestDigest}_${value.manifestSize}`
}

export function parseDevotionalWorkspaceAssetId(
  assetId: string,
): DevotionalWorkspaceAssetId | null {
  const match = /^(dv2i|dv2o)_g(\d+)_([a-f0-9]{24})_([a-f0-9]{64})_(\d+)$/.exec(
    assetId,
  )
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) {
    return null
  }
  const workspaceGeneration = Number(match[2])
  const manifestSize = Number(match[5])
  if (
    !Number.isSafeInteger(workspaceGeneration) ||
    workspaceGeneration <= 0 ||
    !Number.isSafeInteger(manifestSize) ||
    manifestSize <= 0
  ) {
    return null
  }
  return {
    kind: match[1] === "dv2i" ? "input" : "output",
    workspaceGeneration,
    attemptToken: match[3],
    manifestDigest: match[4],
    manifestSize,
  }
}

export function devotionalManifestRefFromAssetId(
  assetId: string,
): WorkspaceArtifactRef | null {
  const parsed = parseDevotionalWorkspaceAssetId(assetId)
  if (!parsed) return null
  return {
    schemaVersion: "2",
    key: `runs/g${parsed.workspaceGeneration}/${parsed.attemptToken}/${
      parsed.kind === "input" ? "run-input" : "attempt-output"
    }/manifest.json`,
    digest: parsed.manifestDigest,
    size: parsed.manifestSize,
    contentType: "application/json",
    attempt: {
      workspaceGeneration: parsed.workspaceGeneration,
      attemptId: parsed.attemptToken,
      runId: parsed.attemptToken,
    },
  }
}

export function validateWorkspaceKey(key: string): void {
  if (
    key.startsWith("/") ||
    key.endsWith("/") ||
    !WORKSPACE_KEY_PATTERN.test(key) ||
    key.split("/").some((part) => part === "." || part === "..") ||
    (!WORKSPACE_RUN_KEY_PATTERN.test(key) &&
      !WORKSPACE_MANIFEST_KEY_PATTERN.test(key) &&
      !SOURCE_MEDIA_KEY_PATTERN.test(key))
  ) {
    throw new ArtifactIntegrityError(
      `Workspace key is outside allowed prefixes: ${key}`,
    )
  }
}

function validateWorkspaceRef(ref: WorkspaceArtifactRef): void {
  validateWorkspaceKey(ref.key)
  assertAttemptIdentity(ref.attempt)
  if (
    ref.schemaVersion !== "2" ||
    !SHA256_PATTERN.test(ref.digest) ||
    !Number.isSafeInteger(ref.size) ||
    ref.size <= 0
  ) {
    throw new ArtifactIntegrityError("invalid Workspace artifact reference")
  }
  const ext = ref.key.split(".").at(-1)?.toLowerCase()
  if (!ext || !CONTENT_TYPES_BY_EXTENSION[ext]?.includes(ref.contentType)) {
    throw new ArtifactIntegrityError(
      `content type ${ref.contentType} does not match ${ref.key}`,
    )
  }
  const contentAddressed = WORKSPACE_RUN_KEY_PATTERN.exec(ref.key)
  if (contentAddressed && ref.key.split("/")[4] !== ref.digest) {
    throw new ArtifactIntegrityError(
      `Workspace key digest does not match reference: ${ref.key}`,
    )
  }
}

async function digestReadable(stream: Readable): Promise<{
  digest: string
  size: number
}> {
  const hash = createHash("sha256")
  let size = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    hash.update(bytes)
  }
  return { digest: hash.digest("hex"), size }
}

function workspaceRef(
  options: Omit<WriteWorkspaceArtifactOptions, "body">,
): WorkspaceArtifactRef {
  const ref: WorkspaceArtifactRef = {
    schemaVersion: "2",
    key: options.key,
    digest: options.digest,
    size: options.size,
    contentType: options.contentType,
    attempt: options.attempt,
  }
  validateWorkspaceRef(ref)
  return ref
}

function assertDigestAndSize(
  actual: { digest: string; size: number },
  expected: { digest: string; size: number },
): void {
  if (actual.digest !== expected.digest || actual.size !== expected.size) {
    throw new ArtifactIntegrityError(
      `artifact digest/size mismatch: expected ${expected.digest}/${expected.size}, got ${actual.digest}/${actual.size}`,
    )
  }
}

function integrityTransform(ref: WorkspaceArtifactRef): Transform {
  const hash = createHash("sha256")
  let size = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength
      hash.update(chunk)
      callback(null, chunk)
    },
    flush(callback) {
      try {
        assertDigestAndSize(
          { digest: hash.digest("hex"), size },
          { digest: ref.digest, size: ref.size },
        )
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
  })
}

function validateKeyComponent(value: string, name: string): void {
  if (!SAFE_KEY_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: must contain only alphanumeric characters, hyphens, and underscores`,
    )
  }
}

function parseByteRange(
  header: string | undefined,
  totalSize: number,
): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || totalSize <= 0) {
    throw new ArtifactRangeNotSatisfiableError(totalSize)
  }
  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new ArtifactRangeNotSatisfiableError(totalSize)
    }
    start = Math.max(0, totalSize - suffixLength)
    end = totalSize - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : totalSize - 1
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= totalSize ||
    end < start
  ) {
    throw new ArtifactRangeNotSatisfiableError(totalSize)
  }
  return { start, end: Math.min(end, totalSize - 1) }
}

export function artifactKey(
  assetId: string,
  artifactType: string,
  ext: string,
): string {
  validateKeyComponent(assetId, "assetId")
  validateKeyComponent(artifactType, "artifactType")
  validateKeyComponent(ext, "ext")
  return `${assetId}/${artifactType}.${ext}`
}

function defaultConfig(): StorageConfig {
  return {
    s3: env.RAILWAY_S3_BUCKET
      ? {
          endpoint: env.RAILWAY_S3_ENDPOINT,
          region: env.RAILWAY_S3_REGION,
          bucket: env.RAILWAY_S3_BUCKET,
          accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID,
          secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY,
        }
      : undefined,
    localRootDir: env.SHORTS_WORKER_LOCAL_ARTIFACTS_DIR,
  }
}

function devotionalWorkspaceConfig(): StorageConfig {
  return {
    s3: env.DEVOTIONAL_WORKSPACE_S3_BUCKET
      ? {
          endpoint: env.DEVOTIONAL_WORKSPACE_S3_ENDPOINT,
          region: env.DEVOTIONAL_WORKSPACE_S3_REGION,
          bucket: env.DEVOTIONAL_WORKSPACE_S3_BUCKET,
          accessKeyId: env.DEVOTIONAL_WORKSPACE_S3_ACCESS_KEY_ID,
          secretAccessKey: env.DEVOTIONAL_WORKSPACE_S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.DEVOTIONAL_WORKSPACE_S3_FORCE_PATH_STYLE,
          workspacePrefix: env.DEVOTIONAL_WORKSPACE_PREFIX,
        }
      : undefined,
    localRootDir: env.DEVOTIONAL_WORKSPACE_LOCAL_DIR,
  }
}

export function createStorage(
  config: StorageConfig = defaultConfig(),
): Storage {
  return config.s3 ? createS3Storage(config.s3) : createLocalStorage(config)
}

export function createDevotionalStorage(
  config: StorageConfig = devotionalWorkspaceConfig(),
): Storage {
  return createStorage(config)
}

// ---------------------------------------------------------------------------
// S3 backend (production)
// ---------------------------------------------------------------------------

function createS3Storage(s3Config: NonNullable<StorageConfig["s3"]>): Storage {
  let _s3:
    | InstanceType<typeof import("@aws-sdk/client-s3").S3Client>
    | undefined

  async function getS3() {
    if (!_s3) {
      if (!s3Config.accessKeyId || !s3Config.secretAccessKey) {
        throw new Error(
          "RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY are required when RAILWAY_S3_BUCKET is set",
        )
      }

      const { S3Client } = await import("@aws-sdk/client-s3")

      // Double-check after await to avoid duplicate clients under concurrency
      if (!_s3) {
        _s3 = new S3Client({
          endpoint: s3Config.endpoint,
          region: s3Config.region,
          credentials: {
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
          },
          forcePathStyle: s3Config.forcePathStyle ?? true,
        })
      }
    }
    return _s3
  }

  const normalizedWorkspacePrefix = s3Config.workspacePrefix
    ?.replace(/^\/+|\/+$/gu, "")
    .trim()
  const workspaceStorageKey = (relativeKey: string) =>
    [normalizedWorkspacePrefix, relativeKey].filter(Boolean).join("/")

  async function verifyWorkspaceArtifactAndGetEtag(
    ref: WorkspaceArtifactRef,
  ): Promise<string> {
    validateWorkspaceRef(ref)
    const { GetObjectCommand, HeadObjectCommand } =
      await import("@aws-sdk/client-s3")
    const s3 = await getS3()
    try {
      const key = workspaceStorageKey(ref.key)
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: s3Config.bucket, Key: key }),
      )
      if (
        head.ContentLength !== ref.size ||
        (head.ContentType != null && head.ContentType !== ref.contentType)
      ) {
        throw new ArtifactIntegrityError(
          `artifact metadata mismatch: ${ref.key}`,
        )
      }
      if (!head.ETag) {
        throw new ArtifactIntegrityError(
          `artifact object identity is unavailable: ${ref.key}`,
        )
      }
      const metadataDigest = head.Metadata?.[WORKSPACE_SHA256_METADATA_KEY]
      if (metadataDigest && metadataDigest !== ref.digest) {
        throw new ArtifactIntegrityError(
          `artifact digest metadata mismatch: ${ref.key}`,
        )
      }
      // Metadata is an optimization hint, not content proof: an editor or
      // storage client may overwrite bytes while retaining user metadata.
      // Hash one ETag-bound full stream before approval or Range playback.
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: s3Config.bucket,
          Key: key,
          IfMatch: head.ETag,
        }),
      )
      if (!response.Body) throw new ArtifactNotFoundError(ref.key)
      assertDigestAndSize(
        await digestReadable(response.Body as unknown as Readable),
        ref,
      )
      return head.ETag
    } catch (error) {
      if (isNoSuchKeyError(error)) throw new ArtifactNotFoundError(ref.key)
      throw error
    }
  }

  return {
    backend: "s3",

    async writeArtifact(options) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3")
      const key = artifactKey(
        options.assetId,
        options.artifactType,
        options.ext,
      )
      const s3 = await getS3()

      await s3.send(
        new PutObjectCommand({
          Bucket: s3Config.bucket,
          Key: key,
          Body: options.body,
          ContentType: options.contentType,
        }),
      )

      return key
    },

    async writeArtifactFromFile(
      assetId,
      artifactType,
      ext,
      filePath,
      contentType,
    ) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3")
      const key = artifactKey(assetId, artifactType, ext)
      const s3 = await getS3()
      const { size } = await stat(filePath)

      // Stream the file body — render outputs can be hundreds-of-MB MP4s and
      // must not be buffered in memory.
      await s3.send(
        new PutObjectCommand({
          Bucket: s3Config.bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: size,
          ContentType: contentType,
        }),
      )

      return key
    },

    async readArtifact(assetId, artifactType, ext) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3")
      const key = artifactKey(assetId, artifactType, ext)
      const s3 = await getS3()

      let response
      try {
        response = await s3.send(
          new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: key,
          }),
        )
      } catch (error) {
        if (isNoSuchKeyError(error)) throw new ArtifactNotFoundError(key)
        throw error
      }

      if (!response.Body) {
        throw new Error(`S3 object body is empty for key: ${key}`)
      }
      return response.Body.transformToByteArray()
    },

    async readArtifactToFile(assetId, artifactType, ext, destinationPath) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3")
      const key = artifactKey(assetId, artifactType, ext)
      const s3 = await getS3()

      let response
      try {
        response = await s3.send(
          new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: key,
          }),
        )
      } catch (error) {
        if (isNoSuchKeyError(error)) throw new ArtifactNotFoundError(key)
        throw error
      }

      if (!response.Body) {
        throw new Error(`S3 object body is empty for key: ${key}`)
      }
      await mkdir(dirname(destinationPath), { recursive: true })
      await pipeline(
        response.Body as unknown as Readable,
        createWriteStream(destinationPath),
      )
    },

    async artifactExists(assetId, artifactType, ext) {
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3")
      const key = artifactKey(assetId, artifactType, ext)
      const s3 = await getS3()

      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: s3Config.bucket,
            Key: key,
          }),
        )
        return true
      } catch {
        return false
      }
    },

    async readArtifactStream(assetId, artifactType, ext, rangeHeader) {
      const { GetObjectCommand, HeadObjectCommand } =
        await import("@aws-sdk/client-s3")
      const key = artifactKey(assetId, artifactType, ext)
      const s3 = await getS3()
      let totalSize: number
      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: s3Config.bucket, Key: key }),
        )
        totalSize = head.ContentLength ?? 0
      } catch (error) {
        if (isNoSuchKeyError(error)) throw new ArtifactNotFoundError(key)
        throw error
      }
      const range = parseByteRange(rangeHeader, totalSize)
      let response
      try {
        response = await s3.send(
          new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: key,
            Range: range ? `bytes=${range.start}-${range.end}` : undefined,
          }),
        )
      } catch (error) {
        if (isNoSuchKeyError(error)) throw new ArtifactNotFoundError(key)
        throw error
      }
      if (!response.Body) {
        throw new ArtifactNotFoundError(key)
      }
      return {
        stream: response.Body as unknown as Readable,
        contentLength: range
          ? range.end - range.start + 1
          : (response.ContentLength ?? totalSize),
        ...(range
          ? { contentRange: `bytes ${range.start}-${range.end}/${totalSize}` }
          : {}),
      }
    },

    async deleteArtifact(assetId, artifactType, ext) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3")
      const key = artifactKey(assetId, artifactType, ext)
      const s3 = await getS3()
      await s3.send(
        new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: key }),
      )
    },

    async writeWorkspaceArtifact(options) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3")
      const ref = workspaceRef(options)
      const body = Buffer.from(options.body)
      assertDigestAndSize(
        {
          digest: createHash("sha256").update(body).digest("hex"),
          size: body.byteLength,
        },
        ref,
      )
      const s3 = await getS3()
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: s3Config.bucket,
            Key: workspaceStorageKey(ref.key),
            Body: body,
            ContentLength: ref.size,
            ContentType: ref.contentType,
            IfNoneMatch: "*",
            Metadata: { [WORKSPACE_SHA256_METADATA_KEY]: ref.digest },
          }),
        )
      } catch (error) {
        if (!isPreconditionFailed(error)) throw error
        try {
          await this.verifyWorkspaceArtifact(ref)
        } catch {
          throw new ArtifactConflictError(ref.key)
        }
      }
      return ref
    },

    async writeWorkspaceArtifactFromFile(options) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3")
      const ref = workspaceRef(options)
      assertDigestAndSize(
        await digestReadable(createReadStream(options.filePath)),
        ref,
      )
      const s3 = await getS3()
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: s3Config.bucket,
            Key: workspaceStorageKey(ref.key),
            Body: createReadStream(options.filePath),
            ContentLength: ref.size,
            ContentType: ref.contentType,
            IfNoneMatch: "*",
            Metadata: { [WORKSPACE_SHA256_METADATA_KEY]: ref.digest },
          }),
        )
      } catch (error) {
        if (!isPreconditionFailed(error)) throw error
        try {
          await this.verifyWorkspaceArtifact(ref)
        } catch {
          throw new ArtifactConflictError(ref.key)
        }
      }
      return ref
    },

    async readWorkspaceArtifact(ref) {
      validateWorkspaceRef(ref)
      const { GetObjectCommand } = await import("@aws-sdk/client-s3")
      const s3 = await getS3()
      try {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: workspaceStorageKey(ref.key),
          }),
        )
        if (!response.Body) throw new ArtifactNotFoundError(ref.key)
        const bytes = await response.Body.transformToByteArray()
        assertDigestAndSize(
          {
            digest: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.byteLength,
          },
          ref,
        )
        return bytes
      } catch (error) {
        if (isNoSuchKeyError(error)) throw new ArtifactNotFoundError(ref.key)
        throw error
      }
    },

    async readWorkspaceArtifactToFile(ref, destinationPath) {
      validateWorkspaceRef(ref)
      const { GetObjectCommand } = await import("@aws-sdk/client-s3")
      const s3 = await getS3()
      try {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: workspaceStorageKey(ref.key),
          }),
        )
        if (!response.Body) throw new ArtifactNotFoundError(ref.key)
        await mkdir(dirname(destinationPath), { recursive: true })
        await pipeline(
          response.Body as unknown as Readable,
          integrityTransform(ref),
          createWriteStream(destinationPath),
        )
      } catch (error) {
        await rm(destinationPath, { force: true }).catch(() => {})
        if (isNoSuchKeyError(error)) throw new ArtifactNotFoundError(ref.key)
        throw error
      }
    },

    async verifyWorkspaceArtifact(ref) {
      await verifyWorkspaceArtifactAndGetEtag(ref)
    },

    async readWorkspaceArtifactStream(ref, rangeHeader) {
      const etag = await verifyWorkspaceArtifactAndGetEtag(ref)
      const { GetObjectCommand } = await import("@aws-sdk/client-s3")
      const range = parseByteRange(rangeHeader, ref.size)
      const s3 = await getS3()
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: s3Config.bucket,
          Key: workspaceStorageKey(ref.key),
          IfMatch: etag,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      )
      if (!response.Body) throw new ArtifactNotFoundError(ref.key)
      return {
        stream: response.Body as unknown as Readable,
        contentLength: range ? range.end - range.start + 1 : ref.size,
        ...(range
          ? { contentRange: `bytes ${range.start}-${range.end}/${ref.size}` }
          : {}),
      }
    },

    async workspaceArtifactExists(key) {
      validateWorkspaceKey(key)
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3")
      const s3 = await getS3()
      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: s3Config.bucket,
            Key: workspaceStorageKey(key),
          }),
        )
        return true
      } catch (error) {
        if (isNoSuchKeyError(error)) return false
        throw error
      }
    },

    async readWorkspaceManifest(attempt, area) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3")
      const key = devotionalManifestKey(attempt, area)
      const s3 = await getS3()
      try {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: workspaceStorageKey(key),
          }),
        )
        if (!response.Body) throw new ArtifactNotFoundError(key)
        const body = await response.Body.transformToByteArray()
        if (body.byteLength === 0 || body.byteLength > 1_000_000) {
          throw new ArtifactIntegrityError(`invalid manifest size: ${key}`)
        }
        const ref = workspaceRef({
          key,
          digest: createHash("sha256").update(body).digest("hex"),
          size: body.byteLength,
          contentType: "application/json",
          attempt,
        })
        return { ref, body }
      } catch (error) {
        if (isNoSuchKeyError(error)) return null
        throw error
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Local backend (dev / test)
// ---------------------------------------------------------------------------

function isENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

function createLocalStorage(config: StorageConfig): Storage {
  const root = isAbsolute(config.localRootDir)
    ? config.localRootDir
    : resolve(process.cwd(), config.localRootDir)

  function localPath(key: string): string {
    return join(root, key)
  }

  return {
    backend: "local",

    async writeArtifact(options) {
      const key = artifactKey(
        options.assetId,
        options.artifactType,
        options.ext,
      )
      const filePath = localPath(key)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, options.body)
      return key
    },

    async writeArtifactFromFile(assetId, artifactType, ext, filePath) {
      const key = artifactKey(assetId, artifactType, ext)
      const targetPath = localPath(key)
      await mkdir(dirname(targetPath), { recursive: true })
      await copyFile(filePath, targetPath)
      return key
    },

    async readArtifact(assetId, artifactType, ext) {
      const key = artifactKey(assetId, artifactType, ext)
      try {
        return new Uint8Array(await readFile(localPath(key)))
      } catch (error) {
        if (isENOENT(error)) throw new ArtifactNotFoundError(key)
        throw error
      }
    },

    async readArtifactToFile(assetId, artifactType, ext, destinationPath) {
      const key = artifactKey(assetId, artifactType, ext)
      await mkdir(dirname(destinationPath), { recursive: true })
      try {
        await copyFile(localPath(key), destinationPath)
      } catch (error) {
        if (isENOENT(error)) throw new ArtifactNotFoundError(key)
        throw error
      }
    },

    async artifactExists(assetId, artifactType, ext) {
      const key = artifactKey(assetId, artifactType, ext)
      try {
        await access(localPath(key))
        return true
      } catch {
        return false
      }
    },

    async readArtifactStream(assetId, artifactType, ext, rangeHeader) {
      const key = artifactKey(assetId, artifactType, ext)
      let size: number
      try {
        size = (await stat(localPath(key))).size
      } catch (error) {
        if (isENOENT(error)) throw new ArtifactNotFoundError(key)
        throw error
      }
      const range = parseByteRange(rangeHeader, size)
      return {
        stream: createReadStream(
          localPath(key),
          range ? { start: range.start, end: range.end } : undefined,
        ),
        contentLength: range ? range.end - range.start + 1 : size,
        ...(range
          ? { contentRange: `bytes ${range.start}-${range.end}/${size}` }
          : {}),
      }
    },

    async deleteArtifact(assetId, artifactType, ext) {
      const key = artifactKey(assetId, artifactType, ext)
      await rm(localPath(key), { force: true })
    },

    async writeWorkspaceArtifact(options) {
      const ref = workspaceRef(options)
      const body = Buffer.from(options.body)
      assertDigestAndSize(
        {
          digest: createHash("sha256").update(body).digest("hex"),
          size: body.byteLength,
        },
        ref,
      )
      const targetPath = localPath(ref.key)
      await mkdir(dirname(targetPath), { recursive: true })
      try {
        await writeFile(targetPath, body, { flag: "wx" })
      } catch (error) {
        if (!isFileExistsError(error)) throw error
        try {
          await this.verifyWorkspaceArtifact(ref)
        } catch {
          throw new ArtifactConflictError(ref.key)
        }
      }
      return ref
    },

    async writeWorkspaceArtifactFromFile(options) {
      const ref = workspaceRef(options)
      assertDigestAndSize(
        await digestReadable(createReadStream(options.filePath)),
        ref,
      )
      const targetPath = localPath(ref.key)
      await mkdir(dirname(targetPath), { recursive: true })
      try {
        await copyFile(options.filePath, targetPath, constants.COPYFILE_EXCL)
      } catch (error) {
        if (!isFileExistsError(error)) throw error
        try {
          await this.verifyWorkspaceArtifact(ref)
        } catch {
          throw new ArtifactConflictError(ref.key)
        }
      }
      return ref
    },

    async readWorkspaceArtifact(ref) {
      validateWorkspaceRef(ref)
      try {
        const bytes = await readFile(localPath(ref.key))
        assertDigestAndSize(
          {
            digest: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.byteLength,
          },
          ref,
        )
        return bytes
      } catch (error) {
        if (isENOENT(error)) throw new ArtifactNotFoundError(ref.key)
        throw error
      }
    },

    async readWorkspaceArtifactToFile(ref, destinationPath) {
      validateWorkspaceRef(ref)
      await mkdir(dirname(destinationPath), { recursive: true })
      try {
        await pipeline(
          createReadStream(localPath(ref.key)),
          integrityTransform(ref),
          createWriteStream(destinationPath),
        )
      } catch (error) {
        await rm(destinationPath, { force: true }).catch(() => {})
        if (isENOENT(error)) throw new ArtifactNotFoundError(ref.key)
        throw error
      }
    },

    async verifyWorkspaceArtifact(ref) {
      validateWorkspaceRef(ref)
      try {
        assertDigestAndSize(
          await digestReadable(createReadStream(localPath(ref.key))),
          ref,
        )
      } catch (error) {
        if (isENOENT(error)) throw new ArtifactNotFoundError(ref.key)
        throw error
      }
    },

    async readWorkspaceArtifactStream(ref, rangeHeader) {
      await this.verifyWorkspaceArtifact(ref)
      const range = parseByteRange(rangeHeader, ref.size)
      return {
        stream: createReadStream(
          localPath(ref.key),
          range ? { start: range.start, end: range.end } : undefined,
        ),
        contentLength: range ? range.end - range.start + 1 : ref.size,
        ...(range
          ? { contentRange: `bytes ${range.start}-${range.end}/${ref.size}` }
          : {}),
      }
    },

    async workspaceArtifactExists(key) {
      validateWorkspaceKey(key)
      try {
        await access(localPath(key))
        return true
      } catch (error) {
        if (isENOENT(error)) return false
        throw error
      }
    },

    async readWorkspaceManifest(attempt, area) {
      const key = devotionalManifestKey(attempt, area)
      try {
        const metadata = await stat(localPath(key))
        if (metadata.size <= 0 || metadata.size > 1_000_000) {
          throw new ArtifactIntegrityError(`invalid manifest size: ${key}`)
        }
        const body = await readFile(localPath(key))
        const ref = workspaceRef({
          key,
          digest: createHash("sha256").update(body).digest("hex"),
          size: body.byteLength,
          contentType: "application/json",
          attempt,
        })
        return { ref, body }
      } catch (error) {
        if (isENOENT(error)) return null
        throw error
      }
    },
  }
}
