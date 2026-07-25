// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// Control the crypto/network boundary (U3 already tests it for real); this file
// tests the route's ORCHESTRATION: state check, session set, single-catch,
// non-PII logging, and return_to validation.
vi.mock("@/auth/oauth-client", () => ({
  getChatOAuthConfig: vi.fn(() => ({
    issuerUrl: "https://auth.example.com/api/auth",
    clientId: "chat-client",
    chatBaseUrl: "https://chat.example.com",
  })),
  exchangeChatAuthorizationCode: vi.fn(),
  verifyChatIdToken: vi.fn(),
}))

beforeAll(() => {
  vi.stubEnv("AUTH_ISSUER_URL", "https://auth.example.com/api/auth")
  vi.stubEnv("AUTH_CHAT_CLIENT_ID", "chat-client")
  vi.stubEnv("CHAT_BASE_URL", "https://chat.example.com")
  vi.stubEnv("CHAT_SESSION_SECRET", "s".repeat(40))
})

const STATE = "state-token"
const VERIFIER = "verifier-token"

function callbackRequest({
  code = "auth-code",
  state = STATE,
  stateCookie = STATE,
  verifierCookie = VERIFIER,
  returnToCookie = "https://chat.example.com/thread/9",
  forceLoginCookie = null,
}: {
  code?: string | null
  state?: string | null
  stateCookie?: string | null
  verifierCookie?: string | null
  returnToCookie?: string | null
  forceLoginCookie?: string | null
} = {}) {
  const url = new URL("https://chat.example.com/api/auth/callback")
  if (code !== null) url.searchParams.set("code", code)
  if (state !== null) url.searchParams.set("state", state)
  // Mirror production: NextResponse.cookies.set percent-encodes values, so the
  // raw Cookie header the callback parses carries ENCODED values. Testing the
  // encoded shape is what proves the callback decodes return_to correctly.
  const cookieParts: string[] = []
  if (stateCookie !== null)
    cookieParts.push(
      `forge_chat_oauth_state=${encodeURIComponent(stateCookie)}`,
    )
  if (verifierCookie !== null)
    cookieParts.push(
      `forge_chat_oauth_verifier=${encodeURIComponent(verifierCookie)}`,
    )
  if (returnToCookie !== null)
    cookieParts.push(
      `forge_chat_oauth_return_to=${encodeURIComponent(returnToCookie)}`,
    )
  if (forceLoginCookie !== null)
    cookieParts.push(`forge_chat_force_login=${forceLoginCookie}`)
  return new Request(url, { headers: { cookie: cookieParts.join("; ") } })
}

async function loadRoute() {
  return import("./route")
}

let oauth: typeof import("@/auth/oauth-client")

beforeEach(async () => {
  oauth = await import("@/auth/oauth-client")
  vi.mocked(oauth.exchangeChatAuthorizationCode).mockReset()
  vi.mocked(oauth.verifyChatIdToken).mockReset()
})

describe("GET /api/auth/callback — happy path (F1)", () => {
  it("sets the signed session cookie, clears transient cookies, and 302s to the validated return_to", async () => {
    vi.mocked(oauth.exchangeChatAuthorizationCode).mockResolvedValue({
      access_token: "at",
      id_token: "idt",
    })
    vi.mocked(oauth.verifyChatIdToken).mockResolvedValue({
      subject: "user-123",
      name: "Ada",
      email: "ada@example.com",
    })

    const { GET } = await loadRoute()
    const res = await GET(callbackRequest())

    expect(res.status).toBe(302) // documented status (not the bare-redirect 307)
    expect(res.headers.get("location")).toBe(
      "https://chat.example.com/thread/9",
    )
    const setCookies = res.headers.getSetCookie().join("\n")
    expect(setCookies).toContain("forge_chat_session=")
    // transient cookies deleted (empty value + expired).
    expect(setCookies).toMatch(
      /forge_chat_oauth_state=;[^\n]*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i,
    )

    // The verifier reached verifyChatIdToken as the id_token ONLY (R9).
    expect(oauth.verifyChatIdToken).toHaveBeenCalledWith({
      config: expect.anything(),
      idToken: "idt",
    })
  })

  it("falls back to chat home when the return_to cookie is cross-origin (R10)", async () => {
    vi.mocked(oauth.exchangeChatAuthorizationCode).mockResolvedValue({
      access_token: "at",
      id_token: "idt",
    })
    vi.mocked(oauth.verifyChatIdToken).mockResolvedValue({ subject: "u1" })

    const { GET } = await loadRoute()
    const res = await GET(
      callbackRequest({ returnToCookie: "https://evil.example.com/x" }),
    )
    expect(res.headers.get("location")).toBe("https://chat.example.com/")
  })
})

describe("GET /api/auth/callback — email_verified pass-through (KTD6)", () => {
  it("a verified-email identity mints a session cookie that reads back emailVerified: true", async () => {
    vi.mocked(oauth.exchangeChatAuthorizationCode).mockResolvedValue({
      access_token: "at",
      id_token: "idt",
    })
    vi.mocked(oauth.verifyChatIdToken).mockResolvedValue({
      subject: "user-123",
      email: "ada@example.com",
      emailVerified: true,
    })

    const { GET } = await loadRoute()
    const res = await GET(callbackRequest())

    const sessionValue = res.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("forge_chat_session="))
      ?.split(";")[0]
      ?.slice("forge_chat_session=".length)
    expect(sessionValue).toBeTruthy()

    // The route's pass-through is a one-line optional field that compiles clean
    // if forgotten — only reading the REAL cookie back proves it was threaded.
    const { readChatSessionCookie } = await import("@/auth/session-cookie")
    const identity = await readChatSessionCookie(
      decodeURIComponent(sessionValue ?? ""),
    )
    expect(identity).toMatchObject({
      sub: "user-123",
      email: "ada@example.com",
      emailVerified: true,
    })
  })
})

describe("GET /api/auth/callback — force-login marker consumption (feat-240)", () => {
  it("deletes the marker on SUCCESS (sign-in completed)", async () => {
    vi.mocked(oauth.exchangeChatAuthorizationCode).mockResolvedValue({
      access_token: "at",
      id_token: "idt",
    })
    vi.mocked(oauth.verifyChatIdToken).mockResolvedValue({ subject: "u1" })

    const { GET } = await loadRoute()
    const res = await GET(callbackRequest({ forceLoginCookie: "1" }))

    expect(res.headers.get("location")).toBe(
      "https://chat.example.com/thread/9",
    )
    expect(res.headers.getSetCookie().join("\n")).toMatch(
      /forge_chat_force_login=;[^\n]*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i,
    )
  })

  it("keeps the marker armed on failure so the retry still forces a login page", async () => {
    const { GET } = await loadRoute()
    const res = await GET(
      callbackRequest({
        state: "attacker",
        stateCookie: STATE,
        forceLoginCookie: "1",
      }),
    )

    expect(res.headers.get("location")).toContain("signin=failed")
    expect(res.headers.getSetCookie().join("\n")).not.toContain(
      "forge_chat_force_login=",
    )
  })
})

describe("GET /api/auth/callback — failures (R8/R9/R12, all one catch)", () => {
  it("rejects a state mismatch: no session, home + R12 marker", async () => {
    const { GET } = await loadRoute()
    const res = await GET(
      callbackRequest({ state: "attacker", stateCookie: STATE }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://chat.example.com/?signin=failed",
    )
    expect(res.headers.getSetCookie().join("\n")).not.toContain(
      "forge_chat_session=ey",
    )
    expect(oauth.exchangeChatAuthorizationCode).not.toHaveBeenCalled()
  })

  it("rejects a missing verifier cookie (R8): no session, home", async () => {
    const { GET } = await loadRoute()
    const res = await GET(callbackRequest({ verifierCookie: null }))
    expect(res.headers.get("location")).toContain("signin=failed")
    expect(oauth.exchangeChatAuthorizationCode).not.toHaveBeenCalled()
  })

  it("routes a verify failure through the catch and logs NO PII (R9/R12/KTD7)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const { ChatAuthError } = await import("@/auth/errors")
    vi.mocked(oauth.exchangeChatAuthorizationCode).mockResolvedValue({
      access_token: "at",
      id_token: "idt",
    })
    vi.mocked(oauth.verifyChatIdToken).mockRejectedValue(
      new ChatAuthError("id_token_invalid", "ada@example.com raw token detail"),
    )

    const { GET } = await loadRoute()
    const res = await GET(callbackRequest())
    expect(res.headers.get("location")).toContain("signin=failed")

    const logged = err.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toContain("event=callback_failed")
    expect(logged).toContain("reason=id_token_invalid")
    // No claim value or raw error message leaks into the log line.
    expect(logged).not.toContain("ada@example.com")
    expect(logged).not.toContain("raw token detail")
    err.mockRestore()
  })

  it("routes a token-exchange failure through the SAME catch (not a separate branch)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const { ChatAuthError } = await import("@/auth/errors")
    vi.mocked(oauth.exchangeChatAuthorizationCode).mockRejectedValue(
      new ChatAuthError("token_exchange_failed"),
    )

    const { GET } = await loadRoute()
    const res = await GET(callbackRequest())
    expect(res.headers.get("location")).toContain("signin=failed")
    expect(oauth.verifyChatIdToken).not.toHaveBeenCalled()
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "reason=token_exchange_failed",
    )
    err.mockRestore()
  })

  it("uses a FIXED enum marker value, never reflected free text (KTD7)", async () => {
    const { GET } = await loadRoute()
    const res = await GET(callbackRequest({ state: "x", stateCookie: "y" }))
    const location = new URL(res.headers.get("location") ?? "")
    expect(location.searchParams.get("signin")).toBe("failed")
  })
})

describe("GET /api/auth/callback — R9 no access-token fallback (route boundary)", () => {
  it("passes ONLY id_token to the verifier — never substitutes the access token", async () => {
    const { ChatAuthError } = await import("@/auth/errors")
    // Provider returns an access token but NO id_token.
    vi.mocked(oauth.exchangeChatAuthorizationCode).mockResolvedValue({
      access_token: "at-must-not-be-used-as-identity",
      id_token: undefined,
    })
    vi.mocked(oauth.verifyChatIdToken).mockRejectedValue(
      new ChatAuthError("id_token_missing"),
    )

    const { GET } = await loadRoute()
    const res = await GET(callbackRequest())

    // The route must hand the verifier idToken: undefined, not the access token
    // — guards against a reintroduced route-level `id_token ?? access_token`.
    expect(oauth.verifyChatIdToken).toHaveBeenCalledWith({
      config: expect.anything(),
      idToken: undefined,
    })
    const arg = vi.mocked(oauth.verifyChatIdToken).mock.calls[0][0]
    expect(arg.idToken).not.toBe("at-must-not-be-used-as-identity")
    // No session; fail closed to anonymous with the R12 marker.
    expect(res.headers.get("location")).toContain("signin=failed")
    expect(res.headers.getSetCookie().join("\n")).not.toContain(
      "forge_chat_session=ey",
    )
  })
})
