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
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "MASTRA_SERVICE_API_KEYS required for Mastra production",
    )
  })

  it("requires a database URL in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", "")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "DATABASE_URL required for Mastra production",
    )
  })

  it("defaults storage to the local gateway database in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("DATABASE_URL", "")

    const { getMastraDatabaseUrl } = await import("./env")

    expect(getMastraDatabaseUrl()).toBe(
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
  })
})
