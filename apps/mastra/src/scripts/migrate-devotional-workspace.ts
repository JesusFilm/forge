import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

import { z } from "zod"

import { getDevotionalWorkspaceEnvironment } from "../config/env"
import { resolveDevotionalWorkspaceConfig } from "../services/devotional/workspace/config"
import { toNativeWorkspaceFilesystemPath } from "../services/devotional/workspace/inventory"

const ManifestEntrySchema = z
  .object({
    sourcePath: z.string().min(1),
    destinationPath: z
      .string()
      .startsWith("/")
      .refine((value) => !value.includes("..") && !value.includes("\\")),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    size: z.number().int().nonnegative(),
    contentType: z.string().min(1),
    kind: z.enum(["authored-input", "ledger", "media", "artifact"]),
  })
  .strict()

export const DevotionalMigrationManifestSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
    createdAt: z.string().datetime(),
    restoreDrillPassed: z.literal(true),
    entries: z.array(ManifestEntrySchema).max(20_000),
  })
  .strict()

export type DevotionalMigrationManifest = z.infer<
  typeof DevotionalMigrationManifestSchema
>

export type DevotionalMigrationFilesystem = {
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<Buffer | string>
  writeFile(
    path: string,
    content: Buffer,
    options: { recursive: true; overwrite: false; mimeType: string },
  ): Promise<void>
  readStream?(path: string): Promise<Readable>
  writeStream?(
    path: string,
    content: Readable,
    options: {
      recursive: true
      overwrite: false
      mimeType: string
      size: number
    },
  ): Promise<void>
}

export type DevotionalMigrationReport = {
  runId: string
  manifestDigest: string
  copied: string[]
  unchanged: string[]
  conflicts: Array<{
    path: string
    expectedDigest: string
    actualDigest: string
  }>
  ready: boolean
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex")
}

async function streamSha256(stream: Readable): Promise<{
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

function hasStreamingCopy(
  filesystem: DevotionalMigrationFilesystem,
): filesystem is DevotionalMigrationFilesystem &
  Required<Pick<DevotionalMigrationFilesystem, "readStream" | "writeStream">> {
  return Boolean(filesystem.readStream && filesystem.writeStream)
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "name" in error) &&
    ((error as { code?: string }).code === "EEXIST" ||
      (error as { name?: string }).name === "PreconditionFailed")
  )
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ["ENOENT", "NoSuchKey", "NotFound"].includes(
      (error as { code?: string; name?: string }).code ??
        (error as { name?: string }).name ??
        "",
    )
  )
}

function localMigrationFilesystem(
  resolvePath: (path: string) => string,
): DevotionalMigrationFilesystem {
  return {
    exists: (filePath) =>
      access(resolvePath(filePath)).then(
        () => true,
        () => false,
      ),
    readFile: (filePath) => readFile(resolvePath(filePath)),
    async writeFile(filePath, content) {
      const target = resolvePath(filePath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, { flag: "wx" })
    },
    async readStream(filePath) {
      return createReadStream(resolvePath(filePath))
    },
    async writeStream(filePath, content) {
      const target = resolvePath(filePath)
      await mkdir(dirname(target), { recursive: true })
      try {
        await pipeline(content, createWriteStream(target, { flags: "wx" }))
      } catch (error) {
        if (!isAlreadyExists(error)) {
          const { rm } = await import("node:fs/promises")
          await rm(target, { force: true }).catch(() => undefined)
        }
        throw error
      }
    },
  }
}

function s3MigrationFilesystem(storage: {
  bucket: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
  forcePathStyle: false
}): DevotionalMigrationFilesystem {
  const client = new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
    forcePathStyle: storage.forcePathStyle,
  })
  const prefix = storage.prefix.replace(/^\/+|\/+$/gu, "")
  const keyFor = (workspacePath: string) =>
    [prefix, toNativeWorkspaceFilesystemPath(workspacePath)]
      .filter(Boolean)
      .join("/")
  const readStream = async (workspacePath: string) => {
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: storage.bucket,
          Key: keyFor(workspacePath),
        }),
      )
      if (!response.Body) throw new Error("S3 migration object has no body")
      return response.Body as unknown as Readable
    } catch (error) {
      if (isNotFound(error)) throw new Error(`Missing ${workspacePath}`)
      throw error
    }
  }
  return {
    async exists(workspacePath) {
      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: storage.bucket,
            Key: keyFor(workspacePath),
          }),
        )
        return true
      } catch (error) {
        if (isNotFound(error)) return false
        throw error
      }
    },
    async readFile(workspacePath) {
      const chunks: Buffer[] = []
      for await (const chunk of await readStream(workspacePath)) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    },
    async writeFile(workspacePath, content, options) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: storage.bucket,
            Key: keyFor(workspacePath),
            Body: content,
            ContentLength: content.byteLength,
            ContentType: options.mimeType,
            IfNoneMatch: "*",
          }),
        )
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new Error(`Destination already exists: ${workspacePath}`)
        }
        throw error
      }
    },
    readStream,
    async writeStream(workspacePath, content, options) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: storage.bucket,
            Key: keyFor(workspacePath),
            Body: content,
            ContentLength: options.size,
            ContentType: options.mimeType,
            IfNoneMatch: "*",
          }),
        )
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new Error(`Destination already exists: ${workspacePath}`)
        }
        throw error
      }
    },
  }
}

export function devotionalMigrationManifestDigest(
  manifest: DevotionalMigrationManifest,
): string {
  return sha256(
    JSON.stringify({
      ...manifest,
      entries: [...manifest.entries].sort((left, right) =>
        left.destinationPath.localeCompare(right.destinationPath),
      ),
    }),
  )
}

export async function migrateDevotionalWorkspace(options: {
  manifest: DevotionalMigrationManifest
  source: DevotionalMigrationFilesystem
  destination: DevotionalMigrationFilesystem
  dryRun?: boolean
}): Promise<DevotionalMigrationReport> {
  const manifest = DevotionalMigrationManifestSchema.parse(options.manifest)
  const copied: string[] = []
  const unchanged: string[] = []
  const conflicts: DevotionalMigrationReport["conflicts"] = []
  const destinations = new Set<string>()

  for (const entry of [...manifest.entries].sort((left, right) =>
    left.destinationPath.localeCompare(right.destinationPath),
  )) {
    if (destinations.has(entry.destinationPath)) {
      throw new Error(
        `Duplicate migration destination: ${entry.destinationPath}`,
      )
    }
    destinations.add(entry.destinationPath)

    const streaming =
      hasStreamingCopy(options.source) && hasStreamingCopy(options.destination)
    if ((entry.kind === "media" || entry.kind === "artifact") && !streaming) {
      throw new Error(
        `Streaming migration adapters are required for ${entry.kind}: ${entry.sourcePath}`,
      )
    }
    const sourceContent = streaming
      ? undefined
      : await options.source.readFile(entry.sourcePath)
    const sourceBytes =
      sourceContent === undefined
        ? undefined
        : typeof sourceContent === "string"
          ? Buffer.from(sourceContent)
          : sourceContent
    const sourceIdentity = streaming
      ? await streamSha256(await options.source.readStream!(entry.sourcePath))
      : { digest: sha256(sourceBytes!), size: sourceBytes!.byteLength }
    if (
      sourceIdentity.size !== entry.size ||
      sourceIdentity.digest !== entry.sha256
    ) {
      throw new Error(`Source checksum mismatch: ${entry.sourcePath}`)
    }

    if (await options.destination.exists(entry.destinationPath)) {
      const destinationIdentity = streaming
        ? await streamSha256(
            await options.destination.readStream!(entry.destinationPath),
          )
        : {
            digest: sha256(
              await options.destination.readFile(entry.destinationPath),
            ),
            size: entry.size,
          }
      if (
        destinationIdentity.digest === entry.sha256 &&
        destinationIdentity.size === entry.size
      ) {
        unchanged.push(entry.destinationPath)
      } else {
        conflicts.push({
          path: entry.destinationPath,
          expectedDigest: entry.sha256,
          actualDigest: destinationIdentity.digest,
        })
      }
      continue
    }

    if (!options.dryRun) {
      if (streaming) {
        await options.destination.writeStream!(
          entry.destinationPath,
          await options.source.readStream!(entry.sourcePath),
          {
            recursive: true,
            overwrite: false,
            mimeType: entry.contentType,
            size: entry.size,
          },
        )
      } else {
        await options.destination.writeFile(
          entry.destinationPath,
          sourceBytes!,
          {
            recursive: true,
            overwrite: false,
            mimeType: entry.contentType,
          },
        )
      }
      const writtenIdentity = streaming
        ? await streamSha256(
            await options.destination.readStream!(entry.destinationPath),
          )
        : {
            digest: sha256(
              await options.destination.readFile(entry.destinationPath),
            ),
            size: entry.size,
          }
      if (
        writtenIdentity.digest !== entry.sha256 ||
        writtenIdentity.size !== entry.size
      ) {
        throw new Error(
          `Destination checksum mismatch: ${entry.destinationPath}`,
        )
      }
    }
    copied.push(entry.destinationPath)
  }

  return {
    runId: manifest.runId,
    manifestDigest: devotionalMigrationManifestDigest(manifest),
    copied,
    unchanged,
    conflicts,
    ready: conflicts.length === 0 && !options.dryRun,
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const manifestPath = process.argv
    .slice(2)
    .find((value) => value !== "--dry-run")
  if (!manifestPath) {
    throw new Error(
      "Usage: migrate-devotional-workspace <manifest.json> [--dry-run]",
    )
  }
  const manifest = DevotionalMigrationManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  )
  const config = resolveDevotionalWorkspaceConfig(
    getDevotionalWorkspaceEnvironment(),
  )
  if (config.storage.backend === "unavailable") {
    throw new Error(config.storage.reason)
  }
  const source = localMigrationFilesystem((filePath) => filePath)
  const storage = config.storage
  const destination =
    storage.backend === "s3"
      ? s3MigrationFilesystem(storage)
      : localMigrationFilesystem((workspacePath) =>
          join(
            storage.directory,
            toNativeWorkspaceFilesystemPath(workspacePath),
          ),
        )
  const report = await migrateDevotionalWorkspace({
    manifest,
    dryRun,
    source,
    destination,
  })
  process.stdout.write(`${JSON.stringify(report)}\n`)
  if (!report.ready && !dryRun) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
