import { describe, expect, it, afterEach } from "vitest"
import { writeArtifact, readArtifact, writeObject, readObject } from "./s3"
import { rm } from "node:fs/promises"
import { join } from "node:path"

// Tests use the local fallback (RAILWAY_S3_BUCKET is not set in test env)

const LOCAL_DIR = join(process.cwd(), ".tmp", "artifacts")
const LOCAL_OBJECT_DIR = join(process.cwd(), ".tmp", "objects")

afterEach(async () => {
  await rm(LOCAL_DIR, { recursive: true, force: true })
  await rm(LOCAL_OBJECT_DIR, { recursive: true, force: true })
})

describe("storage — local fallback", () => {
  it("writes and reads an artifact", async () => {
    const key = await writeArtifact({
      assetId: "test-asset",
      artifactType: "transcript",
      ext: "json",
      body: '{"text":"hello"}',
    })

    expect(key).toBe("test-asset/transcript.json")

    const data = await readArtifact("test-asset", "transcript", "json")
    expect(new TextDecoder().decode(data)).toBe('{"text":"hello"}')
  })

  it("rejects unsafe assetId", async () => {
    await expect(
      writeArtifact({
        assetId: "../escape",
        artifactType: "test",
        ext: "txt",
        body: "x",
      }),
    ).rejects.toThrow("Invalid assetId")
  })

  it("rejects unsafe ext", async () => {
    await expect(
      writeArtifact({
        assetId: "ok",
        artifactType: "test",
        ext: "../../etc/passwd",
        body: "x",
      }),
    ).rejects.toThrow("Invalid ext")
  })
})

describe("storage — object-key API (local fallback)", () => {
  it("writes and reads an object at an arbitrary slash-separated key", async () => {
    const key = await writeObject(
      "admin-migrations/core-id-mapping.json",
      '{"ok":true}',
      "application/json",
    )

    expect(key).toBe("admin-migrations/core-id-mapping.json")

    const bytes = await readObject("admin-migrations/core-id-mapping.json")
    expect(new TextDecoder().decode(bytes)).toBe('{"ok":true}')
  })

  it("throws on a missing object in local fallback", async () => {
    await expect(
      readObject("admin-migrations/does-not-exist.json"),
    ).rejects.toThrow(/ENOENT/)
  })

  it("rejects traversal attempts in object keys", async () => {
    await expect(
      writeObject("admin-migrations/../escape.json", "x"),
    ).rejects.toThrow("Invalid object key")
    await expect(readObject("../escape.json")).rejects.toThrow(
      "Invalid object key",
    )
  })

  it("rejects empty, leading-slash, or trailing-slash keys", async () => {
    await expect(writeObject("", "x")).rejects.toThrow("Invalid object key")
    await expect(writeObject("/leading/slash.json", "x")).rejects.toThrow(
      "Invalid object key",
    )
    await expect(writeObject("trailing/slash/", "x")).rejects.toThrow(
      "Invalid object key",
    )
  })

  it("rejects bare-dot segments like 'a/./b' and '.' / '..' ", async () => {
    await expect(writeObject("admin/./b.json", "x")).rejects.toThrow(
      "Invalid object key",
    )
    await expect(writeObject(".", "x")).rejects.toThrow("Invalid object key")
    await expect(writeObject("..", "x")).rejects.toThrow("Invalid object key")
    await expect(writeObject("admin/..", "x")).rejects.toThrow(
      "Invalid object key",
    )
  })
})
