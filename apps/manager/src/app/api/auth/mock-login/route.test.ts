import { beforeEach, describe, expect, it, vi } from "vitest"

describe("GET /api/auth/mock-login", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()

    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MANAGER_BACKEND_MODE", "mock")
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
    vi.stubEnv(
      "MANAGER_SESSION_SECRET",
      "manager-session-secret-change-me-000000",
    )
    vi.stubEnv("MANAGER_BASE_URL", "http://localhost:3002")
  })

  it("sets a local Manager session and redirects to the requested local path", async () => {
    const { GET } = await import("./route")
    const { readManagerSessionCookie } =
      await import("@/lib/manager-session-cookie")

    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/mock-login?returnTo=/dashboard/smart-crop",
      ),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/dashboard/smart-crop",
    )

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("manager-session=")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("Path=/")

    const token = setCookie.match(/manager-session=([^;]+)/)?.[1]
    expect(token).toBeTruthy()
    await expect(readManagerSessionCookie(token)).resolves.toMatchObject({
      id: "mock-manager-1",
      email: "manager@forge.test",
      managerRole: "OPERATOR",
    })
  })

  it("does not allow cross-origin returnTo redirects", async () => {
    const { GET } = await import("./route")

    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/mock-login?returnTo=https://evil.test/path",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/dashboard/coverage",
    )
  })

  it("creates a reviewer session only for the separate reviewer lane", async () => {
    const { GET } = await import("./route")
    const { readManagerSessionCookie } =
      await import("@/lib/manager-session-cookie")

    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/mock-login?role=reviewer&returnTo=/dashboard/jobs",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/subtitle-review",
    )
    const token = (response.headers.get("set-cookie") ?? "").match(
      /manager-session=([^;]+)/,
    )?.[1]
    await expect(readManagerSessionCookie(token)).resolves.toMatchObject({
      managerRole: "REVIEWER",
      reviewerLanguageGrants: [
        expect.objectContaining({
          languageId: "mock-language-es",
          languageSlug: "spanish-latin-america",
        }),
      ],
    })
  })

  it("is unavailable outside local mock Manager mode", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "admin")
    vi.stubEnv("MANAGER_BACKEND_MODE", "admin")

    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost:3002/api/auth/mock-login"),
    )

    expect(response.status).toBe(404)
  })
})
