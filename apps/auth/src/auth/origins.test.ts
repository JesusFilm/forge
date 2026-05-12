import { describe, expect, it, vi } from "vitest"

async function loadOrigins() {
  vi.resetModules()
  return import("./origins")
}

describe("auth origins", () => {
  it("allows configured trusted callback origins", async () => {
    vi.stubEnv("AUTH_TRUSTED_ORIGINS", "https://admin.jesusfilm.org")
    const { resolveAuthCallbackUrl } = await loadOrigins()

    expect(
      resolveAuthCallbackUrl("https://admin.jesusfilm.org/dashboard"),
    ).toBe("https://admin.jesusfilm.org/dashboard")
  })

  it("falls back when callback origin is not trusted", async () => {
    vi.stubEnv("AUTH_TRUSTED_ORIGINS", "https://admin.jesusfilm.org")
    const { resolveAuthCallbackUrl } = await loadOrigins()

    expect(resolveAuthCallbackUrl("https://evil.example/dashboard")).toBe(
      "https://admin.jesusfilm.org/dashboard",
    )
  })
})
