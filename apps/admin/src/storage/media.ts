import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { env } from "@/config/env"
import { readObject, writeObject } from "./s3"

export type MediaStorageBackend = "LOCAL" | "S3" | "MUX"
export type MediaObjectVariant = "original" | "preview"

export type WriteMediaObjectOptions = {
  assetId: string
  filename: string
  variant?: MediaObjectVariant
  body: Buffer | Uint8Array | string
  contentType?: string
  backend?: MediaStorageBackend
}

export type ReadMediaObjectOptions = {
  key: string
  backend?: MediaStorageBackend
}

export class UnsupportedMediaBackendError extends Error {
  constructor(backend: MediaStorageBackend) {
    super(`${backend} media storage does not support direct byte writes`)
    this.name = "UnsupportedMediaBackendError"
  }
}

const LOCAL_MEDIA_DIR = join(process.cwd(), ".tmp", "media-assets")
const SAFE_KEY_COMPONENT_PATTERN = /^[a-zA-Z0-9_-]+$/
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/

export function defaultBackend(): MediaStorageBackend {
  return env.RAILWAY_S3_BUCKET ? "S3" : "LOCAL"
}

export function safeMediaFilename(filename: string): string {
  const cleaned = filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 200)

  return SAFE_FILENAME_PATTERN.test(cleaned) ? cleaned : "upload.bin"
}

function assertSafeAssetId(assetId: string): void {
  if (!SAFE_KEY_COMPONENT_PATTERN.test(assetId)) {
    throw new Error(
      "Invalid assetId: must contain only alphanumeric characters, hyphens, and underscores",
    )
  }
}

function assertSafeVariant(variant: MediaObjectVariant): void {
  if (variant !== "original" && variant !== "preview") {
    throw new Error("Invalid media object variant")
  }
}

function assertSafeFilename(filename: string): void {
  if (!SAFE_FILENAME_PATTERN.test(filename)) {
    throw new Error(
      "Invalid filename: must start with a letter or digit and contain only letters, digits, '.', '-', '_'",
    )
  }
}

export function mediaObjectKey({
  assetId,
  filename,
  variant = "original",
}: {
  assetId: string
  filename: string
  variant?: MediaObjectVariant
}): string {
  assertSafeAssetId(assetId)
  assertSafeVariant(variant)
  assertSafeFilename(filename)
  return `media-assets/${assetId}/${variant}/${filename}`
}

export function isSafeMediaObjectKey(key: string): boolean {
  const parts = key.split("/")
  if (parts.length !== 4) {
    return false
  }

  const [prefix, assetId, variant, filename] = parts
  return (
    prefix === "media-assets" &&
    SAFE_KEY_COMPONENT_PATTERN.test(assetId) &&
    (variant === "original" || variant === "preview") &&
    SAFE_FILENAME_PATTERN.test(filename)
  )
}

function assertSafeMediaObjectKey(key: string): void {
  if (!isSafeMediaObjectKey(key)) {
    throw new Error("Invalid media object key")
  }
}

export async function writeMediaObject({
  assetId,
  filename,
  variant = "original",
  body,
  contentType,
  backend = defaultBackend(),
}: WriteMediaObjectOptions): Promise<string> {
  const key = mediaObjectKey({ assetId, filename, variant })

  if (backend === "MUX") {
    throw new UnsupportedMediaBackendError(backend)
  }

  if (backend === "S3") {
    return writeObject(key, body, contentType)
  }

  const filePath = join(LOCAL_MEDIA_DIR, key)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, body)
  return key
}

export async function readMediaObject({
  key,
  backend = defaultBackend(),
}: ReadMediaObjectOptions): Promise<Uint8Array> {
  assertSafeMediaObjectKey(key)

  if (backend === "MUX") {
    throw new UnsupportedMediaBackendError(backend)
  }

  if (backend === "S3") {
    return readObject(key)
  }

  return readFile(join(LOCAL_MEDIA_DIR, key))
}
