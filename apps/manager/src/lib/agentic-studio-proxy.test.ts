import { beforeEach, describe, expect, it, vi } from "vitest"

const { envMock, verifyManagerSessionMock } = vi.hoisted(() => ({
  envMock: {
    AGENTIC_STUDIO_ORIGIN: "http://agentic-studio.railway.internal:4111" as
      | string
      | undefined,
    AGENTIC_OPERATOR_API_KEY: "operator-token" as string | undefined,
    AGENTIC_BASE_URL: "https://forgeagentic-stage.up.railway.app" as
      | string
      | undefined,
    MANAGER_API_KEY: undefined as string | undefined,
    AGENTIC_SERVICE_API_KEY: undefined as string | undefined,
    MANAGER_AGENTIC_API_KEY: undefined as string | undefined,
    STRAPI_API_TOKEN: undefined as string | undefined,
    STRAPI_INTERNAL_API_TOKEN: undefined as string | undefined,
  },
  verifyManagerSessionMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  hasManagerAccess: (user: { managerRole?: string } | null | undefined) =>
    user?.managerRole === "OPERATOR",
  verifyManagerSession: verifyManagerSessionMock,
}))

vi.mock("@/config/env", () => ({
  env: envMock,
}))

import {
  authorizeAgenticStudioSession,
  proxyAgenticStudioRequest,
} from "./agentic-studio-proxy"

function managerUser(roleName = "Manager") {
  return {
    id: 7,
    username: "manager",
    email: "manager@forge.test",
    role: { name: roleName, type: roleName.toLowerCase() },
    managerRole: roleName === "Manager" ? "OPERATOR" : undefined,
  }
}

function request(
  path = "/api/agentic-studio/api/agents?view=all",
  init: RequestInit = {},
) {
  return new Request(`https://manager.test${path}`, {
    ...init,
    headers: {
      cookie: "manager-session=manager-session",
      ...init.headers,
    },
  })
}

describe("authorizeAgenticStudioSession", () => {
  beforeEach(() => {
    Object.assign(envMock, {
      AGENTIC_STUDIO_ORIGIN: "http://agentic-studio.railway.internal:4111",
      AGENTIC_OPERATOR_API_KEY: "operator-token",
      AGENTIC_BASE_URL: "https://forgeagentic-stage.up.railway.app",
      MANAGER_API_KEY: undefined,
      AGENTIC_SERVICE_API_KEY: undefined,
      MANAGER_AGENTIC_API_KEY: undefined,
      STRAPI_API_TOKEN: undefined,
      STRAPI_INTERNAL_API_TOKEN: undefined,
    })
    verifyManagerSessionMock.mockReset()
  })

  it("rejects requests without an interactive Manager session", async () => {
    const result = await authorizeAgenticStudioSession(
      new Request("https://manager.test/api/agentic-studio", {
        headers: { authorization: "Bearer manager-api-key" },
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected authorization failure")
    expect(result.response.status).toBe(403)
    expect(verifyManagerSessionMock).not.toHaveBeenCalled()
  })

  it("treats malformed session cookies as invalid sessions", async () => {
    const result = await authorizeAgenticStudioSession(
      new Request("https://manager.test/api/agentic-studio", {
        headers: { cookie: "manager-session=%E0%A4%A" },
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected authorization failure")
    expect(result.response.status).toBe(403)
    expect(verifyManagerSessionMock).not.toHaveBeenCalled()
  })

  it("does not accept legacy strapi-jwt cookies", async () => {
    const result = await authorizeAgenticStudioSession(
      new Request("https://manager.test/api/agentic-studio", {
        headers: { cookie: "strapi-jwt=manager-session" },
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected authorization failure")
    expect(result.response.status).toBe(403)
    expect(verifyManagerSessionMock).not.toHaveBeenCalled()
  })

  it("rejects verified non-Manager sessions", async () => {
    verifyManagerSessionMock.mockResolvedValue(managerUser("Editor"))

    const result = await authorizeAgenticStudioSession(request())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected authorization failure")
    expect(result.response.status).toBe(403)
  })

  it("rejects invalid verified sessions", async () => {
    verifyManagerSessionMock.mockResolvedValue(null)

    const result = await authorizeAgenticStudioSession(request())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected authorization failure")
    expect(result.response.status).toBe(403)
  })

  it("accepts verified Manager sessions", async () => {
    verifyManagerSessionMock.mockResolvedValue(managerUser())

    const result = await authorizeAgenticStudioSession(request())

    expect(result.ok).toBe(true)
    expect(verifyManagerSessionMock).toHaveBeenCalledWith("manager-session")
  })
})

describe("proxyAgenticStudioRequest", () => {
  beforeEach(() => {
    Object.assign(envMock, {
      AGENTIC_STUDIO_ORIGIN: "http://agentic-studio.railway.internal:4111",
      AGENTIC_OPERATOR_API_KEY: "operator-token",
      AGENTIC_BASE_URL: "https://forgeagentic-stage.up.railway.app",
      MANAGER_API_KEY: undefined,
      AGENTIC_SERVICE_API_KEY: undefined,
      MANAGER_AGENTIC_API_KEY: undefined,
      STRAPI_API_TOKEN: undefined,
      STRAPI_INTERNAL_API_TOKEN: undefined,
    })
    vi.stubGlobal("fetch", vi.fn())
    verifyManagerSessionMock.mockReset()
    verifyManagerSessionMock.mockResolvedValue(managerUser())
  })

  it("fails closed when the Studio origin is missing", async () => {
    envMock.AGENTIC_STUDIO_ORIGIN = undefined

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["api", "agents"],
    })

    expect(response.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("fails closed when the operator key is missing", async () => {
    envMock.AGENTIC_OPERATOR_API_KEY = undefined

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["api", "agents"],
    })

    expect(response.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("forwards requests to the private Studio origin with operator auth", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["api", "agents"],
    })

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith(
      "http://agentic-studio.railway.internal:4111/api/agents?view=all",
      expect.any(Object),
    )
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer operator-token",
    )
  })

  it("does not forward browser credential, origin, or forwarded headers", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }))

    await proxyAgenticStudioRequest(
      request("/api/agentic-studio/api/agents", {
        headers: {
          authorization: "Bearer browser-token",
          cookie: "manager-session=manager-session; other=value",
          forwarded: "host=evil.test",
          "x-forwarded-host": "evil.test",
          "x-forwarded-proto": "https",
          origin: "https://evil.test",
          referer: "https://evil.test/path",
          accept: "application/json",
        },
      }),
      { path: ["api", "agents"] },
    )

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe("Bearer operator-token")
    expect(headers.get("cookie")).toBeNull()
    expect(headers.get("forwarded")).toBeNull()
    expect(headers.get("x-forwarded-host")).toBeNull()
    expect(headers.get("x-forwarded-proto")).toBeNull()
    expect(headers.get("origin")).toBeNull()
    expect(headers.get("referer")).toBeNull()
    expect(headers.get("accept")).toBe("application/json")
  })

  it("rejects mutating requests without positive same-origin evidence", async () => {
    const response = await proxyAgenticStudioRequest(
      request("/api/agentic-studio/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Agent" }),
      }),
      { path: ["api", "agents"] },
    )

    expect(response.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects mutating requests with cross-site origin evidence", async () => {
    const response = await proxyAgenticStudioRequest(
      request("/api/agentic-studio/api/agents", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Agent" }),
      }),
      { path: ["api", "agents"] },
    )

    expect(response.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("allows mutating requests with exact Manager origin evidence", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }))

    const response = await proxyAgenticStudioRequest(
      request("/api/agentic-studio/api/agents", {
        method: "POST",
        headers: {
          origin: "https://manager.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Agent" }),
      }),
      { path: ["api", "agents"] },
    )

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("allows mutating iframe requests with same-origin fetch metadata", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }))

    const response = await proxyAgenticStudioRequest(
      request("/api/agentic-studio/api/agents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ name: "Agent" }),
      }),
      { path: ["api", "agents"] },
    )

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("allows mutating Studio iframe requests with the proxy-scoped browser header", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }))

    const response = await proxyAgenticStudioRequest(
      request("/api/agentic-studio/api/agents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agentic-studio-request": "1",
        },
        body: JSON.stringify({ name: "Agent" }),
      }),
      { path: ["api", "agents"] },
    )

    expect(response.status).toBe(200)
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get("x-agentic-studio-request")).toBeNull()
  })

  it("allows mutating Studio iframe requests with the signed frame token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<html><head></head><body>Studio</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    )

    const htmlResponse = await proxyAgenticStudioRequest(request(), {
      path: [],
    })
    const token = (await htmlResponse.text()).match(
      /_agentic_studio_token";const t="([^"]+)/,
    )?.[1]
    expect(token).toBeTruthy()

    vi.mocked(fetch).mockReset()
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }))

    const response = await proxyAgenticStudioRequest(
      new Request(
        `https://manager.test/api/agentic-studio/api/agents?_agentic_studio_token=${token}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Agent" }),
        },
      ),
      { path: ["api", "agents"] },
    )

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith(
      "http://agentic-studio.railway.internal:4111/api/agents",
      expect.any(Object),
    )
  })

  it("rewrites known public runtime references in Studio config", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          apiUrl: "https://forgeagentic-stage.up.railway.app/api",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["config.json"],
    })

    await expect(response.text()).resolves.toContain("/api/agentic-studio/api")
  })

  it("rewrites root-relative Studio API and asset references under the proxy prefix", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        '<script src="/assets/index.js"></script><script>fetch("/api/agents")</script>',
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["index.html"],
    })

    await expect(response.text()).resolves.toContain(
      'src="/api/agentic-studio/assets/index.js"',
    )
  })

  it("rewrites root-relative Studio fetch calls under the proxy prefix", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('<script>fetch("/api/agents")</script>', {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["index.html"],
    })

    await expect(response.text()).resolves.toContain(
      'fetch("/api/agentic-studio/api/agents")',
    )
  })

  it("injects a fetch wrapper and signed frame token into Studio HTML for mutating proxy calls", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("<html><head></head><body>Studio</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["index.html"],
    })

    const html = await response.text()
    expect(html).toContain("x-agentic-studio-request")
    expect(html).toContain("_agentic_studio_token")
    expect(html).toContain("window.fetch")
  })

  it("rewrites safe Studio redirects back through the Manager proxy", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "/auth/callback?ok=1" },
      }),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["login"],
    })

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(
      "/api/agentic-studio/auth/callback?ok=1",
    )
  })

  it("rejects Studio redirects outside the private origin", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.test/auth" },
      }),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["login"],
    })

    expect(response.status).toBe(503)
  })

  it("fails closed when rewritten Studio config still exposes internal origins", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          apiUrl: "http://unexpected.railway.internal:4111/api",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["config.json"],
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: "Agentic Studio response is not safe to expose",
    })
  })

  it("fails closed when upstream text echoes the injected operator token", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          authorization: "Bearer operator-token",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["debug", "headers"],
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: "Agentic Studio response included a server secret",
    })
  })

  it("overrides upstream cache policy for authenticated Studio responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: {
          "cache-control": "public, max-age=3600",
          "content-type": "text/plain",
        },
      }),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["api", "agents"],
    })

    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("vary")).toBe("Cookie")
  })

  it("drops upstream set-cookie headers", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "set-cookie": "studio-session=secret",
        },
      }),
    )

    const response = await proxyAgenticStudioRequest(request(), {
      path: ["api", "agents"],
    })

    expect(response.headers.get("set-cookie")).toBeNull()
  })
})
