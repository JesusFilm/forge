import { describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    AUTH_TRUSTED_ORIGINS: undefined,
    BETTER_AUTH_URL: undefined,
    NODE_ENV: "production",
  },
}))

describe("auth origins", () => {
  it("defaults production auth to auth.jesusfilm.org", async () => {
    const { getAuthBaseURL } = await import("./origins")

    expect(getAuthBaseURL()).toBe("https://auth.jesusfilm.org")
  })

  it("trusts production app origins when no env override is configured", async () => {
    const {
      getAuthTrustedOrigins,
      getDefaultLoginDestinationName,
      getDefaultPostLoginURL,
      getLoginDestinationName,
      isTrustedAuthOrigin,
      resolveAuthCallbackURL,
    } = await import("./origins")

    expect(getAuthTrustedOrigins()).toEqual([
      "https://admin.jesusfilm.org",
      "https://web.jesusfilm.org",
      "https://manager.jesusfilm.org",
    ])
    expect(isTrustedAuthOrigin("https://admin.jesusfilm.org")).toBe(true)
    expect(isTrustedAuthOrigin("https://auth.jesusfilm.org")).toBe(true)
    expect(isTrustedAuthOrigin("https://evil.example")).toBe(false)
    expect(getDefaultPostLoginURL()).toBe(
      "https://admin.jesusfilm.org/dashboard",
    )
    expect(getDefaultLoginDestinationName()).toBe("Forge administration panel")
    expect(resolveAuthCallbackURL("/dashboard")).toBe(
      "https://admin.jesusfilm.org/dashboard",
    )
    expect(resolveAuthCallbackURL("https://evil.example/dashboard")).toBe(
      "https://admin.jesusfilm.org/dashboard",
    )
    expect(
      getLoginDestinationName("https://admin.jesusfilm.org/dashboard"),
    ).toBe("Forge administration panel")
  })
})
