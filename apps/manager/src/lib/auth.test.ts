import { afterEach, describe, expect, it, vi } from "vitest"

describe("authenticateManagerOverrideRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("accepts the generic manager API key for override approval", async () => {
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    const { authenticateManagerOverrideRequest } = await import("./auth")

    const result = await authenticateManagerOverrideRequest(
      new Request("http://example.test", {
        headers: {
          authorization: "Bearer manager-key",
        },
      }),
    )

    expect(result).toEqual({
      kind: "api_key",
      approvedByUserId: "service:manager-api-key",
    })
  })

  it("rejects invalid bearer tokens for override approval", async () => {
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    const { authenticateManagerOverrideRequest } = await import("./auth")

    const result = await authenticateManagerOverrideRequest(
      new Request("http://example.test", {
        headers: {
          authorization: "Bearer wrong-key",
        },
      }),
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
    await expect((result as Response).json()).resolves.toEqual({
      error: "Interactive Manager session or API key required",
    })
  })
})
