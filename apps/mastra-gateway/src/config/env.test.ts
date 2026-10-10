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

  it("refuses overlapping devotional gateway credentials", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_INTERNAL_API_KEY", "service-key")
    vi.stubEnv("MASTRA_DEVOTIONAL_APPROVAL_API_KEY", "approval-key")
    vi.stubEnv("MASTRA_DEVOTIONAL_PLAYBACK_API_KEY", "approval-key")

    const { assertGatewayRuntimeEnv } = await import("./env")

    expect(() => assertGatewayRuntimeEnv()).toThrow(/must be disjoint/)
  })
})
