import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ArtifactNotFoundError,
  artifactKey,
  createStorage,
  isNoSuchKeyError,
  type Storage,
} from "./storage.js"

describe("artifactKey", () => {
  it("builds {assetId}/{artifactType}.{ext}", () => {
    expect(
      artifactKey("asset123-short-ab12cd34", "shorts-clip-v1", "mp4"),
    ).toBe("asset123-short-ab12cd34/shorts-clip-v1.mp4")
  })

  it.each([
    ["assetId", ["../evil", "shorts-clip-v1", "mp4"]],
    ["artifactType", ["asset123", "a/b", "json"]],
    ["ext", ["asset123", "shorts-output-v1", "mp4?x=1"]],
  ])("rejects unsafe %s", (_name, [assetId, artifactType, ext]) => {
    expect(() => artifactKey(assetId!, artifactType!, ext!)).toThrow(/Invalid/)
  })
})

describe("isNoSuchKeyError", () => {
  it("matches the typed AWS SDK v3 surface FIRST (error.name)", () => {
    // The message deliberately does NOT match the regex backstop, so only
    // the typed branch can satisfy this assertion (root CLAUDE.md:
    // mocked-shape-vs-real-contract discipline).
    expect(
      isNoSuchKeyError(Object.assign(new Error("x"), { name: "NoSuchKey" })),
    ).toBe(true)
    expect(
      isNoSuchKeyError(Object.assign(new Error("x"), { name: "NotFound" })),
    ).toBe(true)
  })

  it("matches the legacy error.Code surface", () => {
    expect(
      isNoSuchKeyError(Object.assign(new Error("x"), { Code: "NoSuchKey" })),
    ).toBe(true)
  })

  it("falls back to the message regex backstop only", () => {
    expect(
      isNoSuchKeyError(new Error("The specified key does not exist")),
    ).toBe(true)
    expect(isNoSuchKeyError(new Error("ENOENT: no such file"))).toBe(true)
  })

  it("rejects unrelated errors and non-objects", () => {
    expect(isNoSuchKeyError(new Error("AccessDenied"))).toBe(false)
    expect(isNoSuchKeyError("NoSuchKey")).toBe(false)
    expect(isNoSuchKeyError(null)).toBe(false)
  })
})

describe("local storage backend", () => {
  let root: string
  let storage: Storage

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shorts-worker-storage-"))
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
      artifactType: "shorts-clip-meta-v1",
      ext: "json",
      body: JSON.stringify({ ok: true }),
      contentType: "application/json",
    })

    expect(key).toBe("asset123/shorts-clip-meta-v1.json")

    const bytes = await storage.readArtifact(
      "asset123",
      "shorts-clip-meta-v1",
      "json",
    )
    expect(JSON.parse(Buffer.from(bytes).toString("utf8"))).toEqual({
      ok: true,
    })
  })

  it("writeArtifactFromFile copies the source file into the artifact tree", async () => {
    const sourcePath = join(root, "render-output.mp4")
    await writeFile(sourcePath, Buffer.from("fake-mp4-bytes"))

    const key = await storage.writeArtifactFromFile(
      "asset456",
      "shorts-output-v1",
      "mp4",
      sourcePath,
      "video/mp4",
    )

    expect(key).toBe("asset456/shorts-output-v1.mp4")
    const copied = await readFile(
      join(root, "asset456", "shorts-output-v1.mp4"),
    )
    expect(copied.toString("utf8")).toBe("fake-mp4-bytes")
  })

  it("readArtifactToFile streams an artifact out to a destination path", async () => {
    await storage.writeArtifact({
      assetId: "asset123",
      artifactType: "shorts-clip-v1",
      ext: "mp4",
      body: Buffer.from("clip-bytes"),
      contentType: "video/mp4",
    })

    const destination = join(root, "tmp-download", "clip.mp4")
    await storage.readArtifactToFile(
      "asset123",
      "shorts-clip-v1",
      "mp4",
      destination,
    )
    expect((await readFile(destination)).toString("utf8")).toBe("clip-bytes")
  })

  it("throws typed ArtifactNotFoundError for missing artifacts", async () => {
    await expect(
      storage.readArtifact("asset123", "shorts-clip-v1", "mp4"),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError)
    await expect(
      storage.readArtifactToFile(
        "asset123",
        "shorts-clip-v1",
        "mp4",
        join(root, "nope.mp4"),
      ),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError)
  })

  it("artifactExists reflects writes", async () => {
    await expect(
      storage.artifactExists("asset123", "shorts-output-v1", "mp4"),
    ).resolves.toBe(false)

    await storage.writeArtifact({
      assetId: "asset123",
      artifactType: "shorts-output-v1",
      ext: "mp4",
      body: Buffer.from([0, 1, 2]),
      contentType: "video/mp4",
    })

    await expect(
      storage.artifactExists("asset123", "shorts-output-v1", "mp4"),
    ).resolves.toBe(true)
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
