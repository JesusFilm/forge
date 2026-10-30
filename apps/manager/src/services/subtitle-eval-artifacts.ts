import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { link, mkdir, open, unlink, type FileHandle } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

import { env } from "@/config/env"
import {
  SHA256,
  sha256Bytes,
} from "@/features/subtitle-lab/subtitle-lab-contract"

export type SubtitleEvalArtifactKind =
  | "source"
  | "reference"
  | "candidate"
  | "review-evidence"
  | "cell-report"

export type SubtitleEvalArtifactIdentity = {
  objectKey: string
  sha256: string
  byteLength: number
  mediaType: string
  replayed: boolean
}

export interface SubtitleEvalArtifactBackend {
  putIfAbsent(
    objectKey: string,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<"created" | "exists">
  read(objectKey: string, maximumBytes?: number): Promise<Uint8Array>
}

export class SubtitleEvalArtifactCollisionError extends Error {
  constructor() {
    super("A content-addressed subtitle evaluation object was not immutable.")
    this.name = "SubtitleEvalArtifactCollisionError"
  }
}

const KEY_PATTERN =
  /^subtitle-eval\/v1\/(source|reference|candidate|review-evidence|cell-report)\/[a-f0-9]{64}\.(vtt|json)$/
export const MAX_SUBTITLE_EVAL_ARTIFACT_BYTES = 3 * 1024 * 1024

export async function writeImmutableSubtitleEvalArtifact(
  input: {
    kind: SubtitleEvalArtifactKind
    body: string | Uint8Array
    mediaType: "text/vtt" | "application/json"
    expectedSha256?: string
  },
  backend: SubtitleEvalArtifactBackend = configuredBackend(),
): Promise<SubtitleEvalArtifactIdentity> {
  const bytes =
    typeof input.body === "string"
      ? new TextEncoder().encode(input.body)
      : input.body
  if (bytes.byteLength > MAX_SUBTITLE_EVAL_ARTIFACT_BYTES) {
    throw new SubtitleEvalArtifactCollisionError()
  }
  const sha256 = sha256Bytes(bytes)
  if (input.expectedSha256 && SHA256.parse(input.expectedSha256) !== sha256) {
    throw new SubtitleEvalArtifactCollisionError()
  }
  const extension = input.mediaType === "text/vtt" ? "vtt" : "json"
  const objectKey = `subtitle-eval/v1/${input.kind}/${sha256}.${extension}`
  const state = await backend.putIfAbsent(objectKey, bytes, input.mediaType)
  if (state === "exists") {
    const current = await backend.read(objectKey, bytes.byteLength)
    if (
      current.byteLength !== bytes.byteLength ||
      sha256Bytes(current) !== sha256
    ) {
      throw new SubtitleEvalArtifactCollisionError()
    }
  }
  return {
    objectKey,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: input.mediaType,
    replayed: state === "exists",
  }
}

export async function readVerifiedSubtitleEvalArtifact(
  input: { objectKey: string; sha256: string; byteLength?: number },
  backend: SubtitleEvalArtifactBackend = configuredBackend(),
) {
  assertObjectKey(input.objectKey)
  const maximumBytes = input.byteLength ?? MAX_SUBTITLE_EVAL_ARTIFACT_BYTES
  assertMaximumBytes(maximumBytes)
  const bytes = await backend.read(input.objectKey, maximumBytes)
  if (
    sha256Bytes(bytes) !== SHA256.parse(input.sha256) ||
    (input.byteLength != null && bytes.byteLength !== input.byteLength)
  ) {
    throw new SubtitleEvalArtifactCollisionError()
  }
  return bytes
}

export function createLocalSubtitleEvalArtifactBackend(
  root = join(process.cwd(), ".tmp", "subtitle-eval-artifacts"),
): SubtitleEvalArtifactBackend {
  const resolvedRoot = resolve(root)
  const pathFor = (objectKey: string) => {
    assertObjectKey(objectKey)
    const path = resolve(resolvedRoot, objectKey)
    if (path !== resolvedRoot && !path.startsWith(`${resolvedRoot}${sep}`)) {
      throw new SubtitleEvalArtifactCollisionError()
    }
    return path
  }
  return {
    async putIfAbsent(objectKey, bytes) {
      const path = pathFor(objectKey)
      await mkdir(join(path, ".."), { recursive: true })
      const temporaryPath = `${path}.${randomUUID()}.tmp`
      let handle: FileHandle | undefined
      try {
        handle = await open(
          temporaryPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        )
        await handle.writeFile(bytes)
        await handle.sync()
        await handle.close()
        handle = undefined
        try {
          await link(temporaryPath, path)
          return "created"
        } catch (error) {
          if (isAlreadyExists(error)) return "exists"
          throw error
        }
      } finally {
        await handle?.close()
        await unlink(temporaryPath).catch((error) => {
          if (!isMissing(error)) throw error
        })
      }
    },
    async read(objectKey, maximumBytes = MAX_SUBTITLE_EVAL_ARTIFACT_BYTES) {
      const path = pathFor(objectKey)
      assertMaximumBytes(maximumBytes)
      const handle = await open(path, constants.O_RDONLY)
      try {
        return await readBoundedFileHandle(handle, maximumBytes)
      } finally {
        await handle.close()
      }
    },
  }
}

export function createS3SubtitleEvalArtifactBackend(input: {
  bucket: string
  client: {
    send(command: unknown): Promise<unknown>
  }
}): SubtitleEvalArtifactBackend {
  return {
    async putIfAbsent(objectKey, bytes, mediaType) {
      assertObjectKey(objectKey)
      const { PutObjectCommand } = await import("@aws-sdk/client-s3")
      try {
        await input.client.send(
          new PutObjectCommand({
            Bucket: input.bucket,
            Key: objectKey,
            Body: bytes,
            ContentType: mediaType,
            IfNoneMatch: "*",
          }),
        )
        return "created"
      } catch (error) {
        if (isPreconditionFailed(error)) return "exists"
        throw error
      }
    },
    async read(objectKey, maximumBytes = MAX_SUBTITLE_EVAL_ARTIFACT_BYTES) {
      assertObjectKey(objectKey)
      assertMaximumBytes(maximumBytes)
      const { GetObjectCommand } = await import("@aws-sdk/client-s3")
      const result = (await input.client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: objectKey }),
      )) as {
        ContentLength?: number
        Body?: {
          transformToByteArray(): Promise<Uint8Array>
          destroy?(): void
          [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array>
        }
      }
      if (!result.Body) throw new Error("Subtitle evaluation object is empty.")
      if (
        typeof result.ContentLength === "number" &&
        result.ContentLength > maximumBytes
      ) {
        result.Body.destroy?.()
        throw new SubtitleEvalArtifactCollisionError()
      }
      if (typeof result.Body[Symbol.asyncIterator] !== "function") {
        result.Body.destroy?.()
        throw new SubtitleEvalArtifactCollisionError()
      }
      return readBoundedStream(result.Body, maximumBytes)
    },
  }
}

let cachedBackend: SubtitleEvalArtifactBackend | undefined

function configuredBackend(): SubtitleEvalArtifactBackend {
  if (cachedBackend) return cachedBackend
  const mode = resolveSubtitleEvalArtifactStorageMode({
    nodeEnv: env.NODE_ENV,
    endpoint: env.RAILWAY_S3_ENDPOINT,
    region: env.RAILWAY_S3_REGION,
    bucket: env.RAILWAY_S3_BUCKET,
    accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID,
    secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY,
  })
  if (mode === "local") {
    cachedBackend = createLocalSubtitleEvalArtifactBackend()
    return cachedBackend
  }
  const lazyClient = {
    client: undefined as
      | InstanceType<typeof import("@aws-sdk/client-s3").S3Client>
      | undefined,
    async send(command: unknown) {
      if (!this.client) {
        const { S3Client } = await import("@aws-sdk/client-s3")
        this.client = new S3Client({
          endpoint: env.RAILWAY_S3_ENDPOINT,
          region: env.RAILWAY_S3_REGION,
          credentials: {
            accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID!,
            secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY!,
          },
          forcePathStyle: true,
        })
      }
      return this.client.send(command as never)
    },
  }
  cachedBackend = createS3SubtitleEvalArtifactBackend({
    bucket: env.RAILWAY_S3_BUCKET!,
    client: lazyClient,
  })
  return cachedBackend
}

export function resolveSubtitleEvalArtifactStorageMode(input: {
  nodeEnv: "development" | "test" | "production"
  endpoint?: string
  region?: string
  bucket?: string
  accessKeyId?: string
  secretAccessKey?: string
}): "local" | "s3" {
  const configured = [
    input.endpoint,
    input.region,
    input.bucket,
    input.accessKeyId,
    input.secretAccessKey,
  ]
  // Region has a harmless local default ("auto"), so it cannot by itself opt
  // development into S3 mode. Any non-default credential/endpoint setting does.
  const hasAnyS3Setting = [
    input.endpoint,
    input.bucket,
    input.accessKeyId,
    input.secretAccessKey,
  ].some(Boolean)
  const hasCompleteS3Settings = configured.every(Boolean)
  if (hasAnyS3Setting && !hasCompleteS3Settings) {
    throw new Error("Subtitle evaluation S3 configuration is incomplete.")
  }
  if (!hasCompleteS3Settings && input.nodeEnv === "production") {
    throw new Error("Subtitle evaluation S3 storage is required in production.")
  }
  return hasCompleteS3Settings ? "s3" : "local"
}

function assertObjectKey(objectKey: string) {
  if (!KEY_PATTERN.test(objectKey)) {
    throw new SubtitleEvalArtifactCollisionError()
  }
}

function assertMaximumBytes(maximumBytes: number) {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 0 ||
    maximumBytes > MAX_SUBTITLE_EVAL_ARTIFACT_BYTES
  ) {
    throw new SubtitleEvalArtifactCollisionError()
  }
}

function isAlreadyExists(error: unknown) {
  return (error as { code?: unknown })?.code === "EEXIST"
}

function isMissing(error: unknown) {
  return (error as { code?: unknown })?.code === "ENOENT"
}

function isPreconditionFailed(error: unknown) {
  const value = error as {
    name?: unknown
    $metadata?: { httpStatusCode?: number }
  }
  return (
    value?.name === "PreconditionFailed" ||
    value?.$metadata?.httpStatusCode === 412
  )
}

async function readBoundedStream(
  body: {
    destroy?(): void
    [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array>
  },
  maximumBytes: number,
) {
  const chunks: Uint8Array[] = []
  let byteLength = 0
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    byteLength += chunk.byteLength
    if (byteLength > maximumBytes) {
      body.destroy?.()
      throw new SubtitleEvalArtifactCollisionError()
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function readBoundedFileHandle(handle: FileHandle, maximumBytes: number) {
  const info = await handle.stat()
  if (!info.isFile() || info.size > maximumBytes) {
    throw new SubtitleEvalArtifactCollisionError()
  }
  const buffer = new Uint8Array(maximumBytes + 1)
  let byteLength = 0
  while (byteLength <= maximumBytes) {
    const { bytesRead } = await handle.read(
      buffer,
      byteLength,
      buffer.byteLength - byteLength,
      byteLength,
    )
    if (bytesRead === 0) break
    byteLength += bytesRead
  }
  if (byteLength > maximumBytes) {
    throw new SubtitleEvalArtifactCollisionError()
  }
  return buffer.slice(0, byteLength)
}
