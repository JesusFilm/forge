import { afterEach, describe, expect, it, vi } from "vitest"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import {
  mediaObjectKey,
  readMediaObject,
  safeMediaFilename,
  UnsupportedMediaBackendError,
  writeMediaObject,
} from "./media"
import { writeObject } from "./s3"

vi.mock("./s3", () => ({
  writeObject: vi.fn(async (key: string) => key),
  readObject: vi.fn(async () => new TextEncoder().encode("from-s3")),
}))

const LOCAL_MEDIA_DIR = join(process.cwd(), ".tmp", "media-assets")

afterEach(async () => {
  vi.clearAllMocks()
  await rm(LOCAL_MEDIA_DIR, { recursive: true, force: true })
})

describe("media storage", () => {
  it("builds stable object keys under the media-assets prefix", () => {
    expect(
      mediaObjectKey({
        assetId: "asset_123",
        variant: "preview",
        filename: "hero.jpg",
      }),
    ).toBe("media-assets/asset_123/preview/hero.jpg")
  })

  it("rejects unsafe asset ids and filenames before storage writes", async () => {
    await expect(
      writeMediaObject({
        backend: "LOCAL",
        assetId: "../escape",
        filename: "hero.jpg",
        body: "x",
      }),
    ).rejects.toThrow("Invalid assetId")

    await expect(
      writeMediaObject({
        backend: "LOCAL",
        assetId: "asset_123",
        filename: "../hero.jpg",
        body: "x",
      }),
    ).rejects.toThrow("Invalid filename")
  })

  it("normalizes uploaded filenames into safe object key components", () => {
    expect(safeMediaFilename("Hero Image (Final).webp")).toBe(
      "Hero-Image-Final-.webp",
    )
    expect(safeMediaFilename("../../secret")).toBe("secret")
    expect(safeMediaFilename("")).toBe("upload.bin")
  })

  it("writes and reads local media objects without S3 credentials", async () => {
    const key = await writeMediaObject({
      backend: "LOCAL",
      assetId: "asset_123",
      filename: "hero.jpg",
      body: "image-bytes",
      contentType: "image/jpeg",
    })

    expect(key).toBe("media-assets/asset_123/original/hero.jpg")

    const bytes = await readMediaObject({ backend: "LOCAL", key })
    expect(new TextDecoder().decode(bytes)).toBe("image-bytes")
  })

  it("rejects unsafe object keys before storage reads", async () => {
    await expect(
      readMediaObject({ backend: "LOCAL", key: "../secret" }),
    ).rejects.toThrow("Invalid media object key")

    await expect(
      readMediaObject({
        backend: "S3",
        key: "media-assets/asset_123/original/../../secret",
      }),
    ).rejects.toThrow("Invalid media object key")
  })

  it("delegates S3-compatible writes to the object-key API", async () => {
    const key = await writeMediaObject({
      backend: "S3",
      assetId: "asset_123",
      filename: "hero.jpg",
      body: "image-bytes",
      contentType: "image/jpeg",
    })

    expect(key).toBe("media-assets/asset_123/original/hero.jpg")
    expect(writeObject).toHaveBeenCalledWith(
      "media-assets/asset_123/original/hero.jpg",
      "image-bytes",
      "image/jpeg",
    )
  })

  it("does not support direct byte writes to the future Mux backend", async () => {
    await expect(
      writeMediaObject({
        backend: "MUX",
        assetId: "asset_123",
        filename: "source.mp4",
        body: "video",
        contentType: "video/mp4",
      }),
    ).rejects.toBeInstanceOf(UnsupportedMediaBackendError)
  })
})
