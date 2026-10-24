import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({ env: {} }))
let original: string
beforeEach(async () => {
  original = process.cwd()
  process.chdir(await mkdtemp(join(process.env.TMPDIR!, "immutable-")))
  vi.resetModules()
})
afterEach(() => process.chdir(original))
describe("reviewed local conditional publication", () => {
  it("atomically publishes one immutable object and accepts an equal retry", async () => {
    const { writeImmutableArtifact } = await import("./storage")
    const options = {
      assetId: "asset",
      artifactType: "subtitles-fr-reviewed-r0001-j1",
      ext: "vtt",
      body: "original bytes",
    }
    await Promise.all([
      writeImmutableArtifact(options),
      writeImmutableArtifact(options),
    ])
    await expect(
      writeImmutableArtifact({ ...options, body: "changed bytes!" }),
    ).rejects.toThrow("identity conflict")
    await expect(
      writeImmutableArtifact({ ...options, body: "short" }),
    ).rejects.toThrow("byte limit")
    expect(
      await readFile(
        ".tmp/artifacts/asset/subtitles-fr-reviewed-r0001-j1.vtt",
        "utf8",
      ),
    ).toBe(options.body)
  })
  it("rejects traversal and over-limit bodies before publication", async () => {
    const { writeImmutableArtifact } = await import("./storage")
    const options = {
      assetId: "asset",
      artifactType: "review",
      ext: "vtt",
      body: "bytes",
    }
    await expect(
      writeImmutableArtifact({ ...options, artifactType: "../escape" }),
    ).rejects.toThrow()
    await expect(
      writeImmutableArtifact({ ...options, body: "x".repeat(512 * 1024 + 1) }),
    ).rejects.toThrow("byte limit")
  })
})
