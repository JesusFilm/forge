import { afterEach, describe, expect, it, vi } from "vitest"

describe("Manager logout route", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("returns JSON for POST and clears Manager, OAuth, and legacy cookies", async () => {
    stubMockEnv()
    const { POST } = await import("./route")
    const response = POST()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("manager-session=;")
    expect(setCookie).toContain("manager-oauth-state=;")
    expect(setCookie).toContain("manager-oauth-verifier=;")
    expect(setCookie).toContain("manager-oauth-return-to=;")
    expect(setCookie).toContain("strapi-jwt=;")
    expect(setCookie).toContain("Expires=Thu, 01 Jan 1970")
  })

  it("redirects GET logout through the configured Manager origin without Auth client env", async () => {
    stubMockEnv()
    const { GET } = await import("./route")
    const response = GET()

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://manager.jesusfilm.org/api/auth/login?prompt=login",
    )

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("manager-session=;")
    expect(setCookie).toContain("manager-oauth-state=;")
    expect(setCookie).toContain("manager-oauth-verifier=;")
    expect(setCookie).toContain("manager-oauth-return-to=;")
    expect(setCookie).toContain("strapi-jwt=;")
  })
})

function stubMockEnv() {
  vi.stubEnv("MANAGER_DATA_MODE", "mock")
  vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
  vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
  vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
  vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
  vi.stubEnv("MANAGER_BASE_URL", "https://manager.jesusfilm.org")
}
