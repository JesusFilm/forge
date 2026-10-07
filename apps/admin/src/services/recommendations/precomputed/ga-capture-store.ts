import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { chmod, copyFile, link, mkdir, open, unlink } from "node:fs/promises"
import { constants } from "node:fs"
import { resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { env } from "@/config/env"
import { GaCaptureError } from "./ga-capture-error"

const HEX = /^[a-f0-9]{64}$/u
const KEY = /^precomputed-ga\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\.bin$/u

export interface GaCaptureStore {
  putIfAbsent(
    key: string,
    sourcePath: string,
    byteLength: number,
  ): Promise<"created" | "exists">
  open(key: string): Promise<Readable>
  delete(key: string): Promise<void>
}

export function gaCaptureStorageKey(
  generationId: string,
  artifactSha256: string,
): string {
  if (
    !generationId.trim() ||
    generationId.length > 191 ||
    !HEX.test(artifactSha256)
  )
    throw new GaCaptureError("Invalid GA capture identity")
  const generationHash = createHash("sha256").update(generationId).digest("hex")
  return `precomputed-ga/v1/${generationHash}/${artifactSha256}.bin`
}

function assertKey(key: string): void {
  if (!KEY.test(key)) throw new GaCaptureError("Invalid GA capture storage key")
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  )
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  )
}

/** Explicitly injected in isolated verification; never a production fallback. */
export function createProtectedLocalGaCaptureStore(
  root: string,
): GaCaptureStore {
  const resolvedRoot = resolve(root)
  const pathFor = (key: string) => {
    assertKey(key)
    const path = resolve(resolvedRoot, key)
    if (!path.startsWith(`${resolvedRoot}${sep}`))
      throw new GaCaptureError("GA capture key escaped storage root")
    return path
  }
  return {
    async putIfAbsent(key, sourcePath) {
      const path = pathFor(key)
      const directory = resolve(path, "..")
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await copyFile(sourcePath, temp, constants.COPYFILE_EXCL)
        await chmod(temp, 0o600)
        const file = await open(temp, constants.O_RDONLY)
        try {
          await file.sync()
        } finally {
          await file.close()
        }
        try {
          await link(temp, path)
        } catch (error) {
          if (isAlreadyExists(error)) return "exists"
          throw error
        }
        const dir = await open(directory, constants.O_RDONLY)
        try {
          await dir.sync()
        } finally {
          await dir.close()
        }
        return "created"
      } finally {
        await unlink(temp).catch((error) => {
          if (!isMissing(error)) throw error
        })
      }
    },
    async open(key) {
      return createReadStream(pathFor(key))
    },
    async delete(key) {
      await unlink(pathFor(key)).catch((error) => {
        if (!isMissing(error)) throw error
      })
    },
  }
}

let configured: GaCaptureStore | undefined

/** Existing private Admin S3 bucket; production never falls back to a local file. */
export function configuredGaCaptureStore(): GaCaptureStore {
  if (configured) return configured
  if (
    !env.RAILWAY_S3_BUCKET ||
    !env.RAILWAY_S3_ACCESS_KEY_ID ||
    !env.RAILWAY_S3_SECRET_ACCESS_KEY
  )
    throw new GaCaptureError(
      "Private Admin object storage is required for GA capture",
    )
  const bucket = env.RAILWAY_S3_BUCKET
  let client:
    | InstanceType<typeof import("@aws-sdk/client-s3").S3Client>
    | undefined
  const s3 = async () => {
    if (client) return client
    const [{ S3Client }, { NodeHttpHandler }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@smithy/node-http-handler"),
    ])
    client = new S3Client({
      endpoint: env.RAILWAY_S3_ENDPOINT,
      region: env.RAILWAY_S3_REGION ?? "auto",
      credentials: {
        accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID!,
        secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5_000,
        requestTimeout: 30_000,
      }),
    })
    return client
  }
  configured = {
    async putIfAbsent(key, sourcePath, byteLength) {
      assertKey(key)
      const { PutObjectCommand } = await import("@aws-sdk/client-s3")
      try {
        await (
          await s3()
        ).send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: createReadStream(sourcePath),
            ContentLength: byteLength,
            ContentType: "application/vnd.forge.ga-capture-v1",
            IfNoneMatch: "*",
          }),
        )
        return "created"
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          (("name" in error && error.name === "PreconditionFailed") ||
            ("$metadata" in error &&
              typeof error.$metadata === "object" &&
              error.$metadata !== null &&
              "httpStatusCode" in error.$metadata &&
              error.$metadata.httpStatusCode === 412))
        )
          return "exists"
        throw error
      }
    },
    async open(key) {
      assertKey(key)
      const { GetObjectCommand } = await import("@aws-sdk/client-s3")
      const response = await (
        await s3()
      ).send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!response.Body) throw new GaCaptureError("GA capture object is empty")
      return Readable.from(response.Body as AsyncIterable<Uint8Array>)
    },
    async delete(key) {
      assertKey(key)
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3")
      await (
        await s3()
      ).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
  return configured
}
