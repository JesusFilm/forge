import { describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    AUTH_ISSUER_URL: "https://auth.jesusfilm.org/api/auth",
    ADMIN_BASE_URL: undefined,
    NODE_ENV: "production",
  },
}))

describe("auth origins", () => {
  it("defaults production auth to auth.jesusfilm.org", async () => {
    const { getAuthBaseURL } = await import("./origins")

    expect(getAuthBaseURL()).toBe("https://auth.jesusfilm.org")
  })

  it("trusts only the configured admin return destination origin", async () => {
    const {
      getDefaultLoginDestinationName,
      getDefaultPostLoginURL,
      getLoginDestinationName,
      isTrustedReturnToOrigin,
      resolveAdminReturnToURL,
    } = await import("./origins")

    expect(isTrustedReturnToOrigin("https://admin.jesusfilm.org")).toBe(true)
    expect(isTrustedReturnToOrigin("https://auth.jesusfilm.org")).toBe(false)
    expect(isTrustedReturnToOrigin("https://evil.example")).toBe(false)
    expect(getDefaultPostLoginURL()).toBe(
      "https://admin.jesusfilm.org/dashboard",
    )
    expect(getDefaultLoginDestinationName()).toBe("Forge administration panel")
    expect(resolveAdminReturnToURL("/dashboard")).toBe(
      "https://admin.jesusfilm.org/dashboard",
    )
    expect(resolveAdminReturnToURL("https://evil.example/dashboard")).toBe(
      "https://admin.jesusfilm.org/dashboard",
    )
    expect(
      getLoginDestinationName("https://admin.jesusfilm.org/dashboard"),
    ).toBe("Forge administration panel")
  })
})
