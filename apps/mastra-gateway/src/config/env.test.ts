import { afterEach, describe, expect, it, vi } from "vitest"

describe("Mastra gateway env", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("parses bootstrap admin emails", async () => {
    vi.stubEnv(
      "MASTRA_GATEWAY_BOOTSTRAP_ADMIN_EMAILS",
      " A@Example.com, b@test ",
    )

    const { getBootstrapAdminEmails } = await import("./env")

    expect(getBootstrapAdminEmails()).toEqual(["a@example.com", "b@test"])
  })

  it("requires production runtime configuration", async () => {
    vi.stubEnv("NODE_ENV", "production")

    const { assertGatewayRuntimeEnv } = await import("./env")

    expect(() => assertGatewayRuntimeEnv()).toThrow(
      /DATABASE_URL.*required for Mastra gateway production/,
    )
  })
})
