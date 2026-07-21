import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  rateLimitMock,
  resolvePrincipalMock,
  experienceLocaleFindFirst,
  experienceLocaleFindUniqueOrThrow,
  transactionMock,
} = vi.hoisted(() => ({
  rateLimitMock: vi.fn(),
  resolvePrincipalMock: vi.fn(),
  experienceLocaleFindFirst: vi.fn(),
  experienceLocaleFindUniqueOrThrow: vi.fn(),
  transactionMock: vi.fn(),
}))

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute: rateLimitMock }))
vi.mock("@/auth/admin-mcp-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/admin-mcp-oauth")>()
  return {
    ...actual,
    resolveAdminMcpPrincipal: (...args: unknown[]) =>
      resolvePrincipalMock(...args),
  }
})
vi.mock("@/db/client", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    experience: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    experienceLocale: {
      findFirst: (...args: unknown[]) => experienceLocaleFindFirst(...args),
      findUniqueOrThrow: (...args: unknown[]) =>
        experienceLocaleFindUniqueOrThrow(...args),
    },
  },
}))
vi.mock("@/services/revalidate-webhook", () => ({
  emitRevalidateWebhook: vi.fn(),
}))
vi.mock("@/services/watch-route-manifest-refresh.service", () => ({
  refreshWatchRouteManifest: vi.fn().mockResolvedValue({ ok: true }),
}))

import { AdminMcpAuthError } from "@/auth/admin-mcp-oauth"
import { GET as protectedResourceGet } from "@/app/.well-known/oauth-protected-resource/route"
import { GET, POST } from "./route"

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://admin.jesusfilm.org/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer token",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe("Admin MCP route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMock.mockResolvedValue({ allowed: true, source: "ip" })
    resolvePrincipalMock.mockResolvedValue({
      principal: { id: "user_1", role: "EDITOR" },
      token: { subject: "user_1", scopes: [] },
    })
    experienceLocaleFindFirst.mockReset()
    experienceLocaleFindUniqueOrThrow.mockReset()
    transactionMock.mockImplementation((callback) =>
      callback({
        contentRevision: { create: vi.fn() },
        experienceLocale: { update: vi.fn() },
      }),
    )
  })

  it("publishes OAuth protected resource metadata", async () => {
    const res = protectedResourceGet()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      resource: "http://localhost:3003/mcp",
      authorization_servers: [expect.any(String)],
      bearer_methods_supported: ["header"],
      scopes_supported: expect.arrayContaining([
        "experience:read",
        "experience:locale:create",
        "experience:locale:update",
        "experience:locale:validate",
        "media:read",
        "video:read",
        "bible:read",
        "experience:publish",
      ]),
      resource_name: "Jesus Film Admin MCP",
    })
  })

  it("rate-limits before OAuth verification", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, source: "ip" })

    const res = await POST(
      post({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    )

    expect(res.status).toBe(429)
    expect(resolvePrincipalMock).not.toHaveBeenCalled()
  })

  it("returns OAuth challenges for missing or invalid bearer tokens", async () => {
    resolvePrincipalMock.mockRejectedValueOnce(
      new AdminMcpAuthError(
        "missing_token",
        "Admin MCP request is missing a bearer token.",
        ["experience:read"],
      ),
    )

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "experience.list", arguments: {} },
      }),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource",
    )
    await expect(res.json()).resolves.toMatchObject({
      error: "missing_token",
      required_scopes: ["experience:read"],
    })
  })

  it("initializes the MCP server after authentication", async () => {
    const res = await POST(
      post({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        serverInfo: {
          name: "jfp-admin-mcp",
          title: "Jesus Film Admin MCP",
        },
      },
    })
    expect(resolvePrincipalMock).toHaveBeenCalledWith(
      expect.objectContaining({ requiredScopes: [] }),
    )
  })

  it("lists declared Admin MCP tools", async () => {
    const res = await POST(
      post({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "experience.locale.create",
          }),
          expect.objectContaining({
            name: "experience.locale.publish",
          }),
          expect.objectContaining({
            name: "video.search_replacements",
          }),
        ]),
      },
    })
  })

  it("requires publish scope before dispatching the publish tool", async () => {
    experienceLocaleFindUniqueOrThrow.mockResolvedValueOnce({
      id: "loc_1",
      experienceId: "exp-1",
      locale: "es",
      slug: "esperanza",
      isHomepage: false,
      pathSegment: null,
      title: "Esperanza",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [{ t: "text", heading: "Esperanza" }],
      status: "DRAFT",
      publishedAt: null,
      createdAt: new Date("2026-07-21T11:00:00.000Z"),
      updatedAt: new Date("2026-07-21T12:00:00.000Z"),
      experience: { ownerId: "user_1", archivedAt: null },
    })
    transactionMock.mockImplementationOnce(async (callback) =>
      callback({
        contentRevision: { create: vi.fn() },
        experienceLocale: {
          update: vi.fn().mockResolvedValueOnce({
            id: "loc_1",
            experienceId: "exp-1",
            locale: "es",
            slug: "esperanza",
            isHomepage: false,
            pathSegment: null,
            title: "Esperanza",
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: [{ t: "text", heading: "Esperanza" }],
            status: "PUBLISHED",
            publishedAt: new Date("2026-07-21T12:30:00.000Z"),
            updatedAt: new Date("2026-07-21T12:30:00.000Z"),
          }),
        },
      }),
    )

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "experience.locale.publish",
          arguments: { localeId: "loc_1", reason: "bulk locale factory" },
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(resolvePrincipalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredScopes: ["experience:publish"],
      }),
    )
    await expect(res.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          reason: "bulk locale factory",
          locale: {
            id: "loc_1",
            status: "PUBLISHED",
            publishedAt: "2026-07-21T12:30:00.000Z",
          },
        },
      },
    })
  })

  it("dispatches implemented read tools and returns structured MCP content", async () => {
    experienceLocaleFindFirst.mockResolvedValueOnce({
      id: "loc-en",
      experienceId: "exp-1",
      locale: "en",
      slug: "hope",
      isHomepage: false,
      pathSegment: null,
      title: "Hope",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [{ t: "text", heading: "Hope" }],
      status: "DRAFT",
      publishedAt: null,
      updatedAt: new Date("2026-07-21T12:00:00.000Z"),
      experience: {
        id: "exp-1",
        isTemplate: false,
        ownerId: "user_1",
      },
    })

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: {
          name: "experience.locale.read",
          arguments: { experienceId: "exp-1", locale: "en" },
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(resolvePrincipalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredScopes: ["experience:read"],
      }),
    )
    await expect(res.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          locale: {
            id: "loc-en",
            slug: "hope",
            blocks: [{ t: "text", heading: "Hope" }],
          },
        },
        content: [
          expect.objectContaining({
            type: "text",
          }),
        ],
      },
    })
  })

  it("rejects unknown tools before claiming implementation", async () => {
    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "not.real", arguments: {} },
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: -32602,
        message: "Unknown Admin MCP tool.",
      },
    })
  })

  it("rejects non-JSON requests", async () => {
    const res = await POST(
      post("{}", {
        "content-type": "text/plain",
      }),
    )

    expect(res.status).toBe(415)
  })

  it("keeps GET explicitly unsupported until streaming transport lands", async () => {
    const res = await GET(new Request("https://admin.jesusfilm.org/mcp"))
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })
})
