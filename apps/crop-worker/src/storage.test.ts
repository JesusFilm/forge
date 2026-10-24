import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { artifactKey, createStorage, type Storage } from "./storage.js"

describe("artifactKey", () => {
  it("builds {assetId}/{artifactType}.{ext}", () => {
    expect(artifactKey("asset123", "smart-crop-fingerprint-v1", "json")).toBe(
      "asset123/smart-crop-fingerprint-v1.json",
    )
  })

  it.each([
    ["assetId", ["../evil", "smart-crop-plan-9x16-v1", "json"]],
    ["artifactType", ["asset123", "a/b", "json"]],
    ["ext", ["asset123", "smart-crop-output-9x16", "mp4?x=1"]],
  ])("rejects unsafe %s", (_name, [assetId, artifactType, ext]) => {
    expect(() => artifactKey(assetId!, artifactType!, ext!)).toThrow(/Invalid/)
  })
})

describe("local storage backend", () => {
  let root: string
  let storage: Storage

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "crop-worker-storage-"))
    storage = createStorage({ localRootDir: root })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("reports the local backend when no S3 bucket is configured", () => {
    expect(storage.backend).toBe("local")
  })

  it("round-trips writeArtifact + readArtifact", async () => {
    const key = await storage.writeArtifact({
      assetId: "asset123",
      artifactType: "smart-crop-fingerprint-v1",
      ext: "json",
      body: JSON.stringify({ ok: true }),
      contentType: "application/json",
    })

    expect(key).toBe("asset123/smart-crop-fingerprint-v1.json")

    const bytes = await storage.readArtifact(
      "asset123",
      "smart-crop-fingerprint-v1",
      "json",
    )
    expect(JSON.parse(Buffer.from(bytes).toString("utf8"))).toEqual({
      ok: true,
    })
  })

  it("artifactExists reflects writes", async () => {
    await expect(
      storage.artifactExists("asset123", "smart-crop-output-9x16", "mp4"),
    ).resolves.toBe(false)

    await storage.writeArtifact({
      assetId: "asset123",
      artifactType: "smart-crop-output-9x16",
      ext: "mp4",
      body: Buffer.from([0, 1, 2]),
      contentType: "video/mp4",
    })

    await expect(
      storage.artifactExists("asset123", "smart-crop-output-9x16", "mp4"),
    ).resolves.toBe(true)
  })

  it("writeArtifactFromFile copies the source file into the artifact tree", async () => {
    const sourcePath = join(root, "render-output.mp4")
    await writeFile(sourcePath, Buffer.from("fake-mp4-bytes"))

    const key = await storage.writeArtifactFromFile(
      "asset456",
      "smart-crop-preview-9x16",
      "mp4",
      sourcePath,
      "video/mp4",
    )

    expect(key).toBe("asset456/smart-crop-preview-9x16.mp4")
    const copied = await readFile(
      join(root, "asset456", "smart-crop-preview-9x16.mp4"),
    )
    expect(copied.toString("utf8")).toBe("fake-mp4-bytes")
  })

  it("rejects unsafe key components end to end", async () => {
    await expect(
      storage.writeArtifact({
        assetId: "../escape",
        artifactType: "x",
        ext: "json",
        body: "{}",
      }),
    ).rejects.toThrow(/Invalid assetId/)
  })
})

describe("s3 storage backend selection", () => {
  it("reports the s3 backend when a bucket is configured", () => {
    const storage = createStorage({
      s3: {
        bucket: "artifacts",
        accessKeyId: "access",
        secretAccessKey: "secret",
      },
      localRootDir: ".tmp/artifacts",
    })

    expect(storage.backend).toBe("s3")
  })
})
