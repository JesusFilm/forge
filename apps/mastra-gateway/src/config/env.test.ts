import { afterEach, describe, expect, it, vi } from "vitest"

describe("Mastra gateway env", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("requires production runtime configuration", async () => {
    vi.stubEnv("NODE_ENV", "production")

    const { assertGatewayRuntimeEnv } = await import("./env")

    expect(() => assertGatewayRuntimeEnv()).toThrow(
      /DATABASE_URL.*required for Mastra gateway production/,
    )
  })
})
