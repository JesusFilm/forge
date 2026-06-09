import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type StoredUpload = {
  key: string
  contentType: string
  byteLength: number
}

export type StoreUploadInput = {
  bytes: Buffer
  contentType: string
}

export type UploadStorage = {
  put(input: StoreUploadInput): Promise<StoredUpload>
  read(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
}

export class UploadNotFoundError extends Error {
  constructor() {
    super("upload_not_found")
    this.name = "UploadNotFoundError"
  }
}

export class FileSystemUploadStorage implements UploadStorage {
  constructor(private readonly rootDir: string) {}

  async put({ bytes, contentType }: StoreUploadInput): Promise<StoredUpload> {
    await mkdir(this.rootDir, { recursive: true })

    const key = `${randomUUID()}.upload`
    await writeFile(join(this.rootDir, key), bytes)

    return {
      key,
      contentType,
      byteLength: bytes.byteLength,
    }
  }

  async read(key: string): Promise<Buffer> {
    return readFile(join(this.rootDir, key))
  }

  async remove(key: string): Promise<void> {
    await rm(join(this.rootDir, key), { force: true })
  }
}

export class InMemoryUploadStorage implements UploadStorage {
  private readonly uploads = new Map<string, Buffer>()

  async put({ bytes, contentType }: StoreUploadInput): Promise<StoredUpload> {
    const key = randomUUID()
    this.uploads.set(key, Buffer.from(bytes))

    return {
      key,
      contentType,
      byteLength: bytes.byteLength,
    }
  }

  async read(key: string): Promise<Buffer> {
    const bytes = this.uploads.get(key)
    if (!bytes) throw new UploadNotFoundError()
    return Buffer.from(bytes)
  }

  async remove(key: string): Promise<void> {
    this.uploads.delete(key)
  }

  has(key: string): boolean {
    return this.uploads.has(key)
  }
}
