import { describe, expect, it, vi } from "vitest"

import {
  StorefrontAdminMcpClient,
  type StorefrontAdminMcpClientConfig,
} from "./storefront-admin-mcp-client"

function config(
  overrides: Partial<StorefrontAdminMcpClientConfig> = {},
): StorefrontAdminMcpClientConfig {
  return {
    mcpUrl: "https://admin.example/mcp",
    allowedHosts: "admin.example,auth.example",
    accessToken: "access-1",
    timeoutMs: 5_000,
    maxResponseBytes: 64 * 1024,
    userAgent: "storefront-test/1.0",
    ...overrides,
  }
}

function bodyThatAbortsAfterFirstChunk(
  errorName: "TimeoutError" | "AbortError" = "TimeoutError",
): ReadableStream<Uint8Array> {
  let readCount = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (readCount++ === 0) {
        controller.enqueue(new TextEncoder().encode('{"partial":'))
        return
      }
      const error = new Error("body read timed out")
      error.name = errorName
      controller.error(error)
    },
  })
}

function toolResponse(data: unknown) {
  return Response.json({
    jsonrpc: "2.0",
    id: "request-1",
    result: { structuredContent: data },
  })
}

describe("Storefront Admin MCP client", () => {
  it("exits without a network call when MCP credentials are missing", async () => {
    const fetchImpl = vi.fn()
    const client = new StorefrontAdminMcpClient({
      config: config({ accessToken: undefined }),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(
      client.callTool("storefront.homepage.context", { locale: "en" }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "oauth_credentials_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("calls a named Admin MCP tool with the configured bearer", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      return toolResponse({ homepage: true })
    })
    const client = new StorefrontAdminMcpClient({
      config: config(),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(
      client.callTool("storefront.homepage.context", { locale: "en" }),
    ).resolves.toEqual({ ok: true, data: { homepage: true } })

    expect(requests[0].url).toBe("https://admin.example/mcp")
    expect(new Headers(requests[0].init?.headers).get("authorization")).toBe(
      "Bearer access-1",
    )
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({
      method: "tools/call",
      params: {
        name: "storefront.homepage.context",
        arguments: { locale: "en" },
      },
    })
  })

  it("blocks an unallowlisted MCP host before attaching a bearer", async () => {
    const fetchImpl = vi.fn()
    const client = new StorefrontAdminMcpClient({
      config: config({ allowedHosts: "auth.example" }),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(client.callTool("experience.list", {})).resolves.toEqual({
      ok: false,
      reason: "ssrf_blocked",
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("renews an offline_access token before a scheduled MCP call", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responses = [
      Response.json({
        access_token: "access-refreshed",
        refresh_token: "refresh-rotated",
        expires_in: 3_600,
      }),
      toolResponse({ locale: "en" }),
    ]
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      return responses[requests.length - 1]
    })
    const client = new StorefrontAdminMcpClient({
      config: config({
        accessToken: undefined,
        authIssuerUrl: "https://auth.example/api/auth",
        clientId: "jfp_admin_mcp_production",
        refreshToken: "refresh-1",
      }),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(
      client.callTool("storefront.homepage.context", { locale: "en" }),
    ).resolves.toEqual({ ok: true, data: { locale: "en" } })

    expect(requests[0].url).toBe("https://auth.example/api/auth/oauth2/token")
    expect(String(requests[0].init?.body)).toContain("grant_type=refresh_token")
    expect(new Headers(requests[1].init?.headers).get("authorization")).toBe(
      "Bearer access-refreshed",
    )
  })

  it("maps a mid-body OAuth timeout without replaying token rotation", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(bodyThatAbortsAfterFirstChunk(), { status: 200 }),
    )
    const client = new StorefrontAdminMcpClient({
      config: config({
        accessToken: undefined,
        authIssuerUrl: "https://auth.example/api/auth",
        clientId: "jfp_admin_mcp_production",
        refreshToken: "refresh-1",
      }),
      fetchImpl: fetchImpl as typeof fetch,
      waitBeforeRetry: vi.fn(async () => undefined),
    })

    await expect(
      client.callTool("storefront.homepage.context", { locale: "en" }),
    ).resolves.toEqual({ ok: false, reason: "timeout", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps a mid-body MCP timeout and retries a read-only tool once", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(bodyThatAbortsAfterFirstChunk("AbortError"), {
          status: 200,
        }),
    )
    const client = new StorefrontAdminMcpClient({
      config: config(),
      fetchImpl: fetchImpl as typeof fetch,
      waitBeforeRetry: vi.fn(async () => undefined),
    })

    await expect(
      client.callTool("storefront.homepage.context", { locale: "en" }),
    ).resolves.toEqual({ ok: false, reason: "timeout", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("never retries the stage mutation after an ambiguous timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("stage timed out")
      error.name = "TimeoutError"
      throw error
    })
    const client = new StorefrontAdminMcpClient({
      config: config(),
      fetchImpl: fetchImpl as typeof fetch,
      waitBeforeRetry: vi.fn(async () => undefined),
    })

    await expect(
      client.callTool("storefront.homepage.stage", { blocks: [] }),
    ).resolves.toEqual({ ok: false, reason: "timeout", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("does not retry preview because it may mint a missing preview token", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }))
    const client = new StorefrontAdminMcpClient({
      config: config(),
      fetchImpl: fetchImpl as typeof fetch,
      waitBeforeRetry: vi.fn(async () => undefined),
    })

    await expect(
      client.callTool("experience.locale.preview", { localeId: "homepage-en" }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("does not retry an unrelated mutation even when its failure is retryable", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }))
    const client = new StorefrontAdminMcpClient({
      config: config(),
      fetchImpl: fetchImpl as typeof fetch,
      waitBeforeRetry: vi.fn(async () => undefined),
    })

    await expect(
      client.callTool("experience.locale.update", {}),
    ).resolves.toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
      status: 503,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("surfaces Admin concurrency errors without exposing the error body", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "request-1",
        error: { code: -32009, message: "details are not propagated" },
      }),
    )
    const client = new StorefrontAdminMcpClient({
      config: config(),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(
      client.callTool("storefront.homepage.stage", {}),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rpc_error",
      rpcCode: -32009,
    })
  })

  it.each(["primitive", [], 42])(
    "returns parse_error without throwing for a malformed JSON-RPC result %#",
    async (result) => {
      const fetchImpl = vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: "request-1", result }),
      )
      const client = new StorefrontAdminMcpClient({
        config: config(),
        fetchImpl: fetchImpl as typeof fetch,
      })

      await expect(
        client.callTool("storefront.homepage.context", { locale: "en" }),
      ).resolves.toEqual({
        ok: false,
        reason: "parse_error",
        retryable: false,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    },
  )
})
