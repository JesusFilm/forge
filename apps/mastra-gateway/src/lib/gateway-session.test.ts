import { afterEach, describe, expect, it, vi } from "vitest"

describe("gateway session cookie", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("round-trips gateway sessions", async () => {
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )

    const { createGatewaySessionCookie, readGatewaySessionCookie } =
      await import("./gateway-session")

    const token = await createGatewaySessionCookie({
      subject: "user-1",
      email: "user@example.com",
      role: "admin",
    })

    await expect(readGatewaySessionCookie(token)).resolves.toEqual({
      subject: "user-1",
      email: "user@example.com",
      name: undefined,
      role: "admin",
    })
  })

  it("returns null for invalid values", async () => {
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )

    const { readGatewaySessionCookie } = await import("./gateway-session")

    await expect(readGatewaySessionCookie("not-a-token")).resolves.toBeNull()
  })
})
