import { afterEach, describe, expect, it, vi } from "vitest"

describe("Mastra env", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("accepts local development without service keys", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("requires service keys in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "")
    vi.stubEnv("MASTRA_STORAGE_DIR", "/data/mastra")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "MASTRA_SERVICE_API_KEYS required for Mastra production",
    )
  })

  it("requires a storage directory in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_STORAGE_DIR", "")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "MASTRA_STORAGE_DIR required for Mastra production",
    )
  })

  it("defaults storage to a local development directory", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_STORAGE_DIR", "")

    const { getMastraStorageDir } = await import("./env")

    expect(getMastraStorageDir()).toBe(".mastra/storage")
  })
})
