import { describe, expect, it, afterEach } from "vitest"
import { writeArtifact, readArtifact } from "./s3"
import { rm } from "node:fs/promises"
import { join } from "node:path"

// Tests use the local fallback (RAILWAY_S3_BUCKET is not set in test env)

const LOCAL_DIR = join(process.cwd(), ".tmp", "artifacts")

afterEach(async () => {
  await rm(LOCAL_DIR, { recursive: true, force: true })
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
