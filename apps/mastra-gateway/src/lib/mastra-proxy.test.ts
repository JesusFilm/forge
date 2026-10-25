import { afterEach, describe, expect, it, vi } from "vitest"

describe("Mastra proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("requests identity encoding and strips stale response encoding headers", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "https://gateway.example.com")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "https://mastra.internal")
    vi.stubEnv("MASTRA_INTERNAL_API_KEY", "internal-key")

    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")

    const token = await createGatewaySessionCookie({
      subject: "user-1",
      email: "user@example.com",
      role: "admin",
    })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("body{}", {
        headers: {
          "content-encoding": "gzip",
          "content-length": "1024",
          "content-type": "application/javascript",
        },
      }),
    )

    const response = await proxyMastraRequest(
      new Request("https://gateway.example.com/studio/assets/index.js", {
        headers: {
          "accept-encoding": "gzip, br",
          cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
      }),
      "/studio/assets/index.js",
    )

    const [, init] = fetchMock.mock.calls[0]
    const upstreamHeaders = init?.headers as Headers
    expect(upstreamHeaders.get("accept-encoding")).toBe("identity")
    expect(response.headers.get("content-encoding")).toBeNull()
    expect(response.headers.get("content-length")).toBeNull()
    expect(response.headers.get("content-type")).toBe("application/javascript")
  })

  it("rewrites Studio bootstrap config to call the gateway origin", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "https://gateway.example.com")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "http://localhost:4111")
    vi.stubEnv("MASTRA_INTERNAL_API_KEY", "internal-key")

    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")

    const token = await createGatewaySessionCookie({
      subject: "user-1",
      email: "user@example.com",
      role: "admin",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          "window.MASTRA_SERVER_HOST = 'localhost';",
          "window.MASTRA_SERVER_PORT = '4111';",
          "window.MASTRA_SERVER_PROTOCOL = 'http';",
        ].join("\n"),
        {
          headers: { "content-type": "text/html" },
        },
      ),
    )

    const response = await proxyMastraRequest(
      new Request("https://gateway.example.com/studio", {
        headers: {
          cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
      }),
      "/studio",
    )

    const body = await response.text()
    expect(body).toContain("window.MASTRA_SERVER_HOST = 'gateway.example.com';")
    expect(body).toContain("window.MASTRA_SERVER_PORT = '443';")
    expect(body).toContain("window.MASTRA_SERVER_PROTOCOL = 'https';")
    expect(body).not.toContain("window.MASTRA_SERVER_PORT = '4111';")
  })

  it("uses the browser-facing host header when rewriting Studio config", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "http://localhost:3005")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "http://localhost:4111")
    vi.stubEnv("MASTRA_INTERNAL_API_KEY", "internal-key")

    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")

    const token = await createGatewaySessionCookie({
      subject: "user-1",
      email: "user@example.com",
      role: "admin",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("window.MASTRA_SERVER_HOST = 'localhost';", {
        headers: { "content-type": "text/html" },
      }),
    )

    const response = await proxyMastraRequest(
      new Request("http://0.0.0.0:3005/studio", {
        headers: {
          host: "localhost:3005",
          cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
      }),
      "/studio",
    )

    await expect(response.text()).resolves.toContain(
      "window.MASTRA_SERVER_HOST = 'localhost';",
    )
  })

  it("streams authenticated byte ranges for devotional approval videos", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "https://gateway.example.com")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "https://mastra.internal")
    vi.stubEnv("MASTRA_INTERNAL_API_KEY", "internal-key")

    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")
    const token = await createGatewaySessionCookie({
      subject: "reviewer-1",
      email: "reviewer@example.com",
      role: "admin",
    })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([2, 3]), {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-range": "bytes 1-2/4",
          "content-length": "2",
          "content-type": "video/mp4",
        },
      }),
    )

    const response = await proxyMastraRequest(
      new Request(
        "https://gateway.example.com/forge-video-first-devotional/assets/devo/devotional-output-portrait-v1/mp4",
        {
          headers: {
            cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
            range: "bytes=1-2",
          },
        },
      ),
      "/forge-video-first-devotional/assets/devo/devotional-output-portrait-v1/mp4",
      { authorizationKey: "playback-only-key" },
    )

    const [upstream, init] = fetchMock.mock.calls[0]
    expect(String(upstream)).toBe(
      "https://mastra.internal/forge-video-first-devotional/assets/devo/devotional-output-portrait-v1/mp4",
    )
    const upstreamHeaders = init?.headers as Headers
    expect(upstreamHeaders.get("authorization")).toBe(
      "Bearer playback-only-key",
    )
    expect(upstreamHeaders.get("range")).toBe("bytes=1-2")
    expect(response.status).toBe(206)
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("content-range")).toBe("bytes 1-2/4")
    await expect(response.arrayBuffer()).resolves.toEqual(
      new Uint8Array([2, 3]).buffer,
    )
  })

  it("uses a dedicated bearer for a human approval proxy", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "https://gateway.example.com")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "https://mastra.internal")
    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")
    const token = await createGatewaySessionCookie({
      subject: "reviewer-1",
      role: "editor",
    })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ status: "published" }))

    await proxyMastraRequest(
      new Request(
        "https://gateway.example.com/forge-video-first-devotional/run1/resume",
        {
          method: "POST",
          headers: {
            cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ approved: true }),
        },
      ),
      "/forge-video-first-devotional/run1/resume",
      { authorizationKey: "approval-only-key", allowedRoles: ["editor"] },
    )

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers
    expect(headers.get("authorization")).toBe("Bearer approval-only-key")
    expect(headers.get("x-forge-user-subject")).toBe("reviewer-1")
    expect(headers.get("x-forge-studio-role")).toBe("editor")
  })

  it("fails closed when fresh access revalidation rejects the session", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "https://gateway.example.com")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "https://mastra.internal")

    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")
    const token = await createGatewaySessionCookie({
      subject: "revoked-1",
      role: "editor",
    })
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const response = await proxyMastraRequest(
      new Request(
        "https://gateway.example.com/forge-video-first-devotional/run1/resume",
        {
          method: "POST",
          headers: {
            cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
          },
        },
      ),
      "/forge-video-first-devotional/run1/resume",
      {
        authorizationKey: "approval-only-key",
        revalidateSession: async () => null,
      },
    )

    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("bounds Workspace request bodies before forwarding them", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "https://gateway.example.com")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "https://mastra.internal")
    vi.stubEnv("MASTRA_INTERNAL_API_KEY", "internal-key")
    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")
    const token = await createGatewaySessionCookie({
      subject: "editor-1",
      role: "editor",
    })
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const response = await proxyMastraRequest(
      new Request(
        "https://gateway.example.com/api/workspaces/devotional-workspace/fs/write",
        {
          method: "POST",
          headers: {
            cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
            "content-length": "101",
            "content-type": "application/json",
          },
          body: JSON.stringify({ path: "/inputs/reflections/new.md" }),
        },
      ),
      "/api/workspaces/devotional-workspace/fs/write",
      { workspaceRequest: true, maxRequestBytes: 100 },
    )

    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("forwards identical bounded Workspace access for editors without cookies", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "https://gateway.example.com")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "https://mastra.internal")
    vi.stubEnv("MASTRA_INTERNAL_API_KEY", "internal-key")
    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")
    const token = await createGatewaySessionCookie({
      subject: "editor-1",
      email: "editor@example.com",
      role: "editor",
    })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ entries: [] }))

    const response = await proxyMastraRequest(
      new Request(
        "https://gateway.example.com/api/workspaces/devotional-workspace/fs/list?path=%2Finputs",
        {
          headers: {
            cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
          },
        },
      ),
      "/api/workspaces/devotional-workspace/fs/list",
      {
        workspaceRequest: true,
        allowedRoles: ["admin", "editor"],
        revalidateSession: async (session) => session,
      },
    )

    expect(response.status).toBe(200)
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get("cookie")).toBeNull()
    expect(headers.get("x-forge-studio-role")).toBe("editor")
    expect(headers.get("x-forge-request-id")).toMatch(/^[a-f0-9-]+$/u)
    expect(headers.get("x-forge-workspace-actor-id")).toBe("editor-1")
    expect(headers.get("x-forge-workspace-request-id")).toBe(
      headers.get("x-forge-request-id"),
    )
  })

  it("forwards a bodyless native Workspace DELETE", async () => {
    vi.stubEnv("MASTRA_GATEWAY_BASE_URL", "https://gateway.example.com")
    vi.stubEnv(
      "MASTRA_GATEWAY_SESSION_SECRET",
      "test-secret-test-secret-test-secret-32",
    )
    vi.stubEnv("MASTRA_INTERNAL_BASE_URL", "https://mastra.internal")
    vi.stubEnv("MASTRA_INTERNAL_API_KEY", "internal-key")
    const { createGatewaySessionCookie, GATEWAY_SESSION_COOKIE } =
      await import("./gateway-session")
    const { proxyMastraRequest } = await import("./mastra-proxy")
    const token = await createGatewaySessionCookie({
      subject: "editor-delete",
      role: "editor",
    })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ deleted: true }))

    const response = await proxyMastraRequest(
      new Request(
        "https://gateway.example.com/api/workspaces/devotional-workspace/fs/delete?path=%2Finputs%2Freflections%2Fold.md",
        {
          method: "DELETE",
          headers: {
            cookie: `${GATEWAY_SESSION_COOKIE}=${encodeURIComponent(token)}`,
          },
        },
      ),
      "/api/workspaces/devotional-workspace/fs/delete",
      { workspaceRequest: true },
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.body).toBeNull()
  })
})
