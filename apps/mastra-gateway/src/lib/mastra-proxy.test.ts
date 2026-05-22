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
})
