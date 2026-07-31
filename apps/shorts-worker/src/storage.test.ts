import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ArtifactNotFoundError,
  ArtifactConflictError,
  ArtifactIntegrityError,
  artifactKey,
  createStorage,
  devotionalWorkspaceKey,
  isNoSuchKeyError,
  type Storage,
} from "./storage.js"

const { s3Send } = vi.hoisted(() => ({ s3Send: vi.fn() }))
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>()
  return {
    ...actual,
    S3Client: class {
      send = s3Send
    },
  }
})

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

  it("writes immutable content-addressed Workspace artifacts idempotently", async () => {
    const attempt = {
      workspaceGeneration: 4,
      attemptId: "attempt_4",
      runId: "run_4",
    }
    const body = Buffer.from("portrait-video")
    const digest = createHash("sha256").update(body).digest("hex")
    const ref = {
      key: devotionalWorkspaceKey(
        attempt,
        "attempt-output",
        digest,
        "portrait.mp4",
      ),
      body,
      digest,
      size: body.byteLength,
      contentType: "video/mp4",
      attempt,
    }

    const written = await storage.writeWorkspaceArtifact(ref)
    await expect(storage.writeWorkspaceArtifact(ref)).resolves.toEqual(written)
    await expect(
      storage.verifyWorkspaceArtifact(written),
    ).resolves.toBeUndefined()

    await writeFile(join(root, written.key), "mutated")
    await expect(
      storage.verifyWorkspaceArtifact(written),
    ).rejects.toBeInstanceOf(ArtifactIntegrityError)
    await expect(storage.writeWorkspaceArtifact(ref)).rejects.toBeInstanceOf(
      ArtifactConflictError,
    )
  })
})

describe("s3 storage backend selection", () => {
  beforeEach(() => s3Send.mockReset())

  function s3Storage() {
    return createStorage({
      s3: {
        bucket: "artifacts",
        accessKeyId: "access",
        secretAccessKey: "secret",
        workspacePrefix: "devotional",
      },
      localRootDir: ".tmp/artifacts",
    })
  }

  it("reports the s3 backend when a bucket is configured", () => {
    const storage = s3Storage()

    expect(storage.backend).toBe("s3")
  })

  it.each([
    [undefined, undefined, 10, undefined],
    ["bytes=2-5", "bytes=2-5", 4, "bytes 2-5/10"],
    ["bytes=-3", "bytes=7-9", 3, "bytes 7-9/10"],
  ])(
    "streams S3 range %s with exact metadata",
    async (requestedRange, sentRange, contentLength, contentRange) => {
      s3Send
        .mockResolvedValueOnce({ ContentLength: 10 })
        .mockResolvedValueOnce({
          Body: Readable.from(Buffer.from("0123456789")),
          ContentLength: contentLength,
        })
      const storage = s3Storage()

      const result = await storage.readArtifactStream(
        "asset123",
        "shorts-output-v1",
        "mp4",
        requestedRange,
      )

      expect(s3Send.mock.calls[0][0].constructor.name).toBe("HeadObjectCommand")
      expect(s3Send.mock.calls[1][0].constructor.name).toBe("GetObjectCommand")
      expect(s3Send.mock.calls[1][0].input).toMatchObject({
        Bucket: "artifacts",
        Key: "asset123/shorts-output-v1.mp4",
        Range: sentRange,
      })
      expect(result.contentLength).toBe(contentLength)
      expect(result.contentRange).toBe(contentRange)
    },
  )

  it("rejects an unsatisfiable S3 range before GET", async () => {
    s3Send.mockResolvedValueOnce({ ContentLength: 10 })
    const storage = s3Storage()

    await expect(
      storage.readArtifactStream(
        "asset123",
        "shorts-output-v1",
        "mp4",
        "bytes=10-12",
      ),
    ).rejects.toMatchObject({ name: "ArtifactRangeNotSatisfiableError" })
    expect(s3Send).toHaveBeenCalledOnce()
  })

  it("maps a typed S3 NoSuchKey head failure", async () => {
    s3Send.mockRejectedValueOnce(
      Object.assign(new Error("x"), { name: "NoSuchKey" }),
    )
    const storage = s3Storage()

    await expect(
      storage.readArtifactStream("asset123", "shorts-output-v1", "mp4"),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError)
  })

  it("hashes an ETag-bound object before streaming a Workspace range", async () => {
    const attempt = {
      workspaceGeneration: 4,
      attemptId: "attempt_4",
      runId: "run_4",
    }
    const body = Buffer.from("portrait-video")
    const digest = createHash("sha256").update(body).digest("hex")
    const key = devotionalWorkspaceKey(
      attempt,
      "attempt-output",
      digest,
      "portrait.mp4",
    )
    s3Send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        ContentLength: body.byteLength,
        ContentType: "video/mp4",
        ETag: '"etag-v1"',
        Metadata: { "forge-sha256": digest },
      })
      .mockResolvedValueOnce({ Body: Readable.from(body) })
      .mockResolvedValueOnce({ Body: Readable.from(body.subarray(0, 4)) })
    const storage = s3Storage()
    const ref = await storage.writeWorkspaceArtifact({
      key,
      body,
      digest,
      size: body.byteLength,
      contentType: "video/mp4",
      attempt,
    })

    await storage.readWorkspaceArtifactStream(ref, "bytes=0-3")

    expect(s3Send).toHaveBeenCalledTimes(4)
    expect(s3Send.mock.calls[0][0].input.Metadata).toEqual({
      "forge-sha256": digest,
    })
    expect(s3Send.mock.calls[0][0].input.Key).toBe(`devotional/${key}`)
    expect(s3Send.mock.calls[1][0].input.Key).toBe(`devotional/${key}`)
    expect(s3Send.mock.calls[2][0].input).toMatchObject({
      Key: `devotional/${key}`,
      IfMatch: '"etag-v1"',
    })
    expect(s3Send.mock.calls[2][0].input.Range).toBeUndefined()
    expect(s3Send.mock.calls[3][0].input).toMatchObject({
      Key: `devotional/${key}`,
      IfMatch: '"etag-v1"',
    })
    expect(s3Send.mock.calls[3][0].input.Range).toBe("bytes=0-3")
  })
})
