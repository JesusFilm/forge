import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    AUTH_TRUSTED_ORIGINS: undefined,
    BETTER_AUTH_URL: undefined,
    NODE_ENV: "production",
  },
}))

function request(path: string, host = "auth.jesusfilm.org") {
  return new NextRequest(`https://${host}${path}`, {
    headers: {
      host,
      "x-forwarded-host": host,
      "x-forwarded-proto": "https",
    },
  })
}

describe("admin proxy auth host guard", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("allows login pages on the auth host", async () => {
    const { proxy } = await import("./proxy")

    const response = proxy(request("/login"))

    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  it("allows Better Auth API routes on the auth host", async () => {
    const { proxy } = await import("./proxy")

    const response = proxy(request("/api/auth/sign-in/social"))

    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  it("allows login assets on the auth host", async () => {
    const { proxy } = await import("./proxy")

    const response = proxy(request("/images/jesus-film-logo-full.svg"))

    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  it("redirects the auth host root to the login page", async () => {
    const { proxy } = await import("./proxy")

    const response = proxy(request("/"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://auth.jesusfilm.org/login?callbackURL=https%3A%2F%2Fadmin.jesusfilm.org%2Fdashboard",
    )
  })

  it("redirects admin pages on the auth host back to the admin host", async () => {
    const { proxy } = await import("./proxy")

    const response = proxy(request("/dashboard/workflows?tab=failed"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://admin.jesusfilm.org/dashboard/workflows?tab=failed",
    )
  })

  it("does not expose non-auth APIs on the auth host", async () => {
    const { proxy } = await import("./proxy")

    const response = proxy(request("/api/graphql"))

    expect(response.status).toBe(404)
  })

  it("does not interfere with the admin host", async () => {
    const { proxy } = await import("./proxy")

    const response = proxy(
      request("/dashboard/workflows", "admin.jesusfilm.org"),
    )

    expect(response.headers.get("x-middleware-next")).toBe("1")
  })
})
