import { afterEach, describe, expect, it, vi } from "vitest"

describe("subtitle enrichment storage", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("uses Manager-compatible artifact keys", async () => {
    const { subtitleArtifactKey } = await import("./storage")

    expect(subtitleArtifactKey("asset_1", "transcript", "json")).toBe(
      "asset_1/transcript.json",
    )
    expect(subtitleArtifactKey("asset_1", "subtitles-en", "vtt")).toBe(
      "asset_1/subtitles-en.vtt",
    )
    expect(subtitleArtifactKey("asset_1", "translation-en", "json")).toBe(
      "asset_1/translation-en.json",
    )
  })

  it("rejects unsafe key components", async () => {
    const { subtitleArtifactKey } = await import("./storage")

    expect(() => subtitleArtifactKey("../asset", "transcript", "json")).toThrow(
      "Invalid assetId",
    )
    expect(() => subtitleArtifactKey("asset", "subtitles/en", "vtt")).toThrow(
      "Invalid artifactType",
    )
  })

  it("requires shared S3 configuration for production readiness", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("RAILWAY_S3_BUCKET", "subtitle-artifacts")
    vi.stubEnv("RAILWAY_S3_ACCESS_KEY_ID", "")
    vi.stubEnv("RAILWAY_S3_SECRET_ACCESS_KEY", "")

    const missing = await import("./storage")
    expect(missing.isSubtitleArtifactStorageProductionReady()).toBe(false)

    vi.resetModules()
    vi.stubEnv("RAILWAY_S3_ACCESS_KEY_ID", "access")
    vi.stubEnv("RAILWAY_S3_SECRET_ACCESS_KEY", "secret")

    const ready = await import("./storage")
    expect(ready.isSubtitleArtifactStorageProductionReady()).toBe(true)
  })
})
