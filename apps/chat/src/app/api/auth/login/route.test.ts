// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const KEYS = [
  "AUTH_ISSUER_URL",
  "AUTH_CHAT_CLIENT_ID",
  "CHAT_BASE_URL",
  "CHAT_SESSION_SECRET",
  "AUTH_COOKIE_PREFIX",
  "NODE_ENV",
] as const

function clearEnv() {
  for (const key of KEYS) delete process.env[key]
}

function setConfigured() {
  process.env.AUTH_ISSUER_URL = "https://auth.example.com/api/auth"
  process.env.AUTH_CHAT_CLIENT_ID = "chat-client"
  process.env.CHAT_BASE_URL = "https://chat.example.com"
  process.env.CHAT_SESSION_SECRET = "s".repeat(40)
}

async function loadRoute() {
  vi.resetModules()
  return import("./route")
}

beforeEach(clearEnv)
afterEach(clearEnv)

describe("GET /api/auth/login", () => {
  it("redirects to apps/auth authorize and sets the hardened transient cookies when configured", async () => {
    setConfigured()
    const { GET } = await loadRoute()
    const res = await GET(
      new Request("https://chat.example.com/api/auth/login?returnTo=/thread/5"),
    )
    expect(res.status).toBe(302) // documented status (not the bare-redirect 307)
    const location = res.headers.get("location") ?? ""
    expect(location).toContain(
      "https://auth.example.com/api/auth/oauth2/authorize",
    )
    expect(location).toContain("code_challenge_method=S256")

    const setCookies = res.headers.getSetCookie().join("\n")
    expect(setCookies).toContain("forge_chat_oauth_state=")
    expect(setCookies).toContain("forge_chat_oauth_verifier=")
    expect(setCookies).toContain("forge_chat_oauth_return_to=")
    // Hardened: HttpOnly + Lax, no Domain (host-only).
    expect(setCookies).toContain("HttpOnly")
    expect(setCookies.toLowerCase()).toContain("samesite=lax")
    expect(setCookies.toLowerCase()).not.toContain("domain=")
  })

  it("refuses to start a flow and returns home when auth is unconfigured (KTD6)", async () => {
    setConfigured()
    delete process.env.CHAT_SESSION_SECRET // missing secret → not configured
    const { GET } = await loadRoute()
    const res = await GET(
      new Request("https://chat.example.com/api/auth/login"),
    )
    expect(res.status).toBe(302)
    const location = res.headers.get("location") ?? ""
    expect(location).not.toContain("auth.example.com")
    expect(res.headers.getSetCookie()).toHaveLength(0)
  })
})
