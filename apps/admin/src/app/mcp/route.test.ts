import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  rateLimitMock,
  resolvePrincipalMock,
  experienceCreate,
  experienceLocaleFindFirst,
  experienceLocaleFindUniqueOrThrow,
  transactionMock,
} = vi.hoisted(() => ({
  rateLimitMock: vi.fn(),
  resolvePrincipalMock: vi.fn(),
  experienceCreate: vi.fn(),
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
      create: (...args: unknown[]) => experienceCreate(...args),
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
import { ADMIN_MCP_TOOLS } from "@/mcp/admin-mcp-tools"
import { emitRevalidateWebhook } from "@/services/revalidate-webhook"
import { refreshWatchRouteManifest } from "@/services/watch-route-manifest-refresh.service"
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
        "offline_access",
        "experience:read",
        "experience:locale:create",
        "experience:locale:update",
        "experience:locale:validate",
        "media:read",
        "video:read",
        "bible:read",
        "experience:publish",
        "experience:create",
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
          expect.objectContaining({
            name: "experience.create",
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

  it("requires the create scope before dispatching experience.create", async () => {
    experienceLocaleFindFirst.mockResolvedValueOnce(null)
    experienceCreate.mockResolvedValueOnce({
      id: "exp-new",
      isTemplate: false,
      ownerId: "user_1",
      locales: [
        {
          id: "loc-new",
          experienceId: "exp-new",
          locale: "en",
          slug: "new-page",
          isHomepage: false,
          pathSegment: null,
          title: "New Page",
          metaDescription: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          blocks: [{ t: "text", heading: "New Page" }],
          status: "DRAFT",
          publishedAt: null,
          updatedAt: new Date("2026-07-27T12:00:00.000Z"),
        },
      ],
    })

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 40,
        method: "tools/call",
        params: {
          name: "experience.create",
          arguments: {
            locale: "en",
            slug: "new-page",
            title: "New Page",
            blocks: [{ t: "text", heading: "New Page" }],
          },
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(resolvePrincipalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredScopes: ["experience:create"],
      }),
    )
    await expect(res.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          created: true,
          experience: { id: "exp-new", ownerId: "user_1" },
          locale: {
            id: "loc-new",
            status: "DRAFT",
            publishedAt: null,
          },
          editorUrl:
            "http://localhost:3003/dashboard/experiences/exp-new?locale=en",
        },
      },
    })
    // DRAFT creation fires no publish side effects.
    expect(vi.mocked(emitRevalidateWebhook)).not.toHaveBeenCalled()
    expect(vi.mocked(refreshWatchRouteManifest)).not.toHaveBeenCalled()
  })

  it("rejects experience.create without the create scope as HTTP 403 and persists nothing", async () => {
    resolvePrincipalMock.mockRejectedValueOnce(
      new AdminMcpAuthError(
        "insufficient_scope",
        "Admin MCP token is missing required scope(s): experience:create.",
        ["experience:create"],
      ),
    )

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: {
          name: "experience.create",
          arguments: {
            locale: "en",
            slug: "new-page",
            title: "New Page",
            blocks: [],
          },
        },
      }),
    )

    expect(res.status).toBe(403)
    expect(res.headers.get("www-authenticate")).toBeNull()
    await expect(res.json()).resolves.toMatchObject({
      error: "insufficient_scope",
      required_scopes: ["experience:create"],
    })
    expect(experienceCreate).not.toHaveBeenCalled()
  })

  it("maps invalid experience.create blocks to -32602 and persists nothing", async () => {
    experienceLocaleFindFirst.mockResolvedValueOnce(null)

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: {
          name: "experience.create",
          arguments: {
            locale: "en",
            slug: "bad-blocks",
            title: "Bad Blocks",
            blocks: [{ t: "nonexistent_block_type" }],
          },
        },
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: -32602,
        message: "Invalid tool arguments.",
      },
    })
    expect(experienceCreate).not.toHaveBeenCalled()
  })

  it("reports the existing resource on a duplicate slug instead of creating", async () => {
    experienceLocaleFindFirst.mockResolvedValueOnce({
      id: "loc-existing",
      experienceId: "exp-existing",
      status: "DRAFT",
    })

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 43,
        method: "tools/call",
        params: {
          name: "experience.create",
          arguments: {
            locale: "en",
            slug: "hope",
            title: "Hope",
            blocks: [],
          },
        },
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          created: false,
          conflict: {
            reason: "slug_exists",
            existingExperienceId: "exp-existing",
            existingLocaleId: "loc-existing",
          },
        },
      },
    })
    expect(experienceCreate).not.toHaveBeenCalled()
  })

  it("accepts a near-cap non-Latin experience.create payload", async () => {
    // ~17k CJK chars ≈ 51KB UTF-8 on the wire — inside the 64KB body cap.
    const cjkParagraph = "あ".repeat(17_000)
    experienceLocaleFindFirst.mockResolvedValueOnce(null)
    experienceCreate.mockResolvedValueOnce({
      id: "exp-cjk",
      isTemplate: false,
      ownerId: "user_1",
      locales: [
        {
          id: "loc-cjk",
          experienceId: "exp-cjk",
          locale: "ja",
          slug: "kibou",
          isHomepage: false,
          pathSegment: null,
          title: "希望",
          metaDescription: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          blocks: [{ t: "text", contentParagraphs: [cjkParagraph] }],
          status: "DRAFT",
          publishedAt: null,
          updatedAt: new Date("2026-07-27T12:00:00.000Z"),
        },
      ],
    })

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 44,
        method: "tools/call",
        params: {
          name: "experience.create",
          arguments: {
            locale: "ja",
            slug: "kibou",
            title: "希望",
            blocks: [{ t: "text", contentParagraphs: [cjkParagraph] }],
          },
        },
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      result: {
        structuredContent: { created: true },
      },
    })
    expect(experienceCreate).toHaveBeenCalled()
  })

  it("has a dispatch branch for every declared tool (registry-dispatch parity)", async () => {
    // A tool definition without a dispatch branch surfaces as JSON-RPC
    // -32601 at call time and nothing else fails — this loop is the parity
    // invariant. Empty arguments hit each tool's Zod gate (-32602) or a
    // downstream error (-32603); NONE may report -32601.
    for (const tool of ADMIN_MCP_TOOLS) {
      const res = await POST(
        post({
          jsonrpc: "2.0",
          id: 50,
          method: "tools/call",
          params: { name: tool.name, arguments: {} },
        }),
      )
      const body = (await res.json()) as {
        error?: { code?: number }
      }
      expect(
        body.error?.code,
        `tool ${tool.name} has no dispatch branch`,
      ).not.toBe(-32601)
    }
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
