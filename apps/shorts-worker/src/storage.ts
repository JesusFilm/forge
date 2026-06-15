// Artifact storage — Railway S3-compatible Object Storage with local
// fallback. Mirrors apps/crop-worker/src/storage.ts: key scheme
// {assetId}/{artifactType}.{ext}, S3 mode toggled by RAILWAY_S3_BUCKET,
// local fallback for dev/test (SHORTS_WORKER_LOCAL_ARTIFACTS_DIR).

import { createReadStream, createWriteStream } from "node:fs"
import {
  access,
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { env } from "./config/env.js"
import { WorkerError } from "./errors.js"

export class ArtifactNotFoundError extends WorkerError {
  constructor(key: string) {
    super(`artifact not found: ${key}`, "artifact_missing", false)
    this.name = "ArtifactNotFoundError"
  }
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
}

const SAFE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

function validateKeyComponent(value: string, name: string): void {
  if (!SAFE_KEY_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: must contain only alphanumeric characters, hyphens, and underscores`,
    )
  }
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

export function createStorage(
  config: StorageConfig = defaultConfig(),
): Storage {
  return config.s3 ? createS3Storage(config.s3) : createLocalStorage(config)
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
          forcePathStyle: true,
        })
      }
    }
    return _s3
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
  }
}
