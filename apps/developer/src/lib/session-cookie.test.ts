import { beforeEach, describe, expect, it, vi } from "vitest"

describe("Developer session cookie", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("AUTH_DATABASE_URL", "postgresql://localhost/forge_auth")
    vi.stubEnv("AUTH_ISSUER_URL", "http://localhost:3004/api/auth")
    vi.stubEnv("AUTH_DEVELOPER_CLIENT_ID", "jfp_developer_local")
    vi.stubEnv("DEVELOPER_BASE_URL", "http://localhost:3006")
    vi.stubEnv("DEVELOPER_SESSION_SECRET", "x".repeat(32))
  })

  it("round-trips Developer principals with developer access", async () => {
    const { createDeveloperSessionCookie, readDeveloperSessionCookie } =
      await import("./session-cookie")

    const cookie = await createDeveloperSessionCookie({
      subject: "user_1",
      email: "dev@example.com",
      name: "Dev User",
      scopes: ["openid", "developer:access"],
    })

    await expect(readDeveloperSessionCookie(cookie)).resolves.toEqual(
      expect.objectContaining({
        subject: "user_1",
        email: "dev@example.com",
        name: "Dev User",
        scopes: ["openid", "developer:access"],
      }),
    )
  })

  it("rejects sessions without developer access", async () => {
    const { createDeveloperSessionCookie, readDeveloperSessionCookie } =
      await import("./session-cookie")

    const cookie = await createDeveloperSessionCookie({
      subject: "user_1",
      scopes: ["openid"],
    })

    await expect(readDeveloperSessionCookie(cookie)).resolves.toBeNull()
  })
})
