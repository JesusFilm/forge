import { describe, expect, it, vi } from "vitest"

async function loadRoute() {
  vi.resetModules()
  return import("./route")
}

describe("auth health route", () => {
  it("returns a healthy service payload", async () => {
    vi.stubEnv("AUTH_BASE_URL", "https://auth.jesusfilm.org")

    const { GET } = await loadRoute()
    const response = GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "forge-auth",
      authBaseUrl: "https://auth.jesusfilm.org",
    })
  })
})
