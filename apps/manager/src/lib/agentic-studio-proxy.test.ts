import { beforeEach, describe, expect, it, vi } from "vitest"

const { verifyManagerSessionMock } = vi.hoisted(() => ({
  verifyManagerSessionMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  verifyManagerSession: verifyManagerSessionMock,
}))

vi.mock("@/config/env", () => ({
  env: {
    AGENTIC_STUDIO_ORIGIN: "http://agentic-studio.railway.internal:4111",
    AGENTIC_OPERATOR_API_KEY: "operator-token",
    AGENTIC_BASE_URL: "https://forgeagentic-stage.up.railway.app",
  },
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
  }
}

function request(
  path = "/api/agentic-studio/api/agents?view=all",
  init: RequestInit = {},
) {
  return new Request(`https://manager.test${path}`, {
    ...init,
    headers: {
      cookie: "strapi-jwt=manager-session",
      ...init.headers,
    },
  })
}

describe("authorizeAgenticStudioSession", () => {
  beforeEach(() => {
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

  it("rejects verified non-Manager sessions", async () => {
    verifyManagerSessionMock.mockResolvedValue(managerUser("Editor"))

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
    vi.stubGlobal("fetch", vi.fn())
    verifyManagerSessionMock.mockReset()
    verifyManagerSessionMock.mockResolvedValue(managerUser())
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
          cookie: "strapi-jwt=manager-session; other=value",
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
