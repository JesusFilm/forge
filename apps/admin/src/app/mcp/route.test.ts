import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  rateLimitMock,
  resolvePrincipalMock,
  experienceCreate,
  experienceFindFirst,
  experienceLocaleFindMany,
  experienceLocaleFindFirst,
  experienceLocaleFindUniqueOrThrow,
  contentRevisionFindFirst,
  contentRevisionCreate,
  transactionMock,
} = vi.hoisted(() => ({
  rateLimitMock: vi.fn(),
  resolvePrincipalMock: vi.fn(),
  experienceCreate: vi.fn(),
  experienceFindFirst: vi.fn(),
  experienceLocaleFindMany: vi.fn(),
  experienceLocaleFindFirst: vi.fn(),
  experienceLocaleFindUniqueOrThrow: vi.fn(),
  contentRevisionFindFirst: vi.fn(),
  contentRevisionCreate: vi.fn(),
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
      findFirst: (...args: unknown[]) => experienceFindFirst(...args),
      create: (...args: unknown[]) => experienceCreate(...args),
    },
    experienceLocale: {
      findMany: (...args: unknown[]) => experienceLocaleFindMany(...args),
      findFirst: (...args: unknown[]) => experienceLocaleFindFirst(...args),
      findUniqueOrThrow: (...args: unknown[]) =>
        experienceLocaleFindUniqueOrThrow(...args),
    },
    contentRevision: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: (...args: unknown[]) => contentRevisionFindFirst(...args),
      create: (...args: unknown[]) => contentRevisionCreate(...args),
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
    experienceFindFirst.mockReset()
    experienceLocaleFindMany.mockReset()
    experienceLocaleFindUniqueOrThrow.mockReset()
    contentRevisionFindFirst.mockReset().mockResolvedValue(null)
    contentRevisionCreate.mockReset().mockResolvedValue({ id: "draft-1" })
    transactionMock.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        experience: {
          create: (...args: unknown[]) => experienceCreate(...args),
        },
        contentRevision: {
          findFirst: (...args: unknown[]) => contentRevisionFindFirst(...args),
          create: (...args: unknown[]) => contentRevisionCreate(...args),
          update: vi.fn(),
        },
        seoProposalMaterialization: { updateMany: vi.fn() },
        experienceLocale: {
          count: vi.fn().mockResolvedValue(1),
          findUniqueOrThrow: (...args: unknown[]) =>
            experienceLocaleFindUniqueOrThrow(...args),
          update: vi.fn(),
        },
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
        "storefront:homepage:stage",
        "experience:locale:validate",
        "media:read",
        "video:read",
        "bible:read",
        "experience:publish",
        "experience:create",
        "experience:generate",
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
            name: "storefront.homepage.context",
          }),
          expect.objectContaining({
            name: "storefront.homepage.stage",
          }),
          expect.objectContaining({
            name: "experience.create",
          }),
          expect.objectContaining({
            name: "experience.duplicate",
          }),
          expect.objectContaining({
            name: "experience.generate",
          }),
        ]),
      },
    })
  })

  it("advertises a non-empty experience id for duplication", async () => {
    const res = await POST(
      post({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    )
    const body = (await res.json()) as {
      result: { tools: typeof ADMIN_MCP_TOOLS }
    }
    const duplicateTool = body.result.tools.find(
      (tool) => tool.name === "experience.duplicate",
    )

    expect(duplicateTool?.inputSchema).toEqual({
      type: "object",
      properties: {
        experienceId: { type: "string", minLength: 1 },
      },
      required: ["experienceId"],
      additionalProperties: false,
    })
  })

  it("keeps the curator stage scope isolated from generic mutations", async () => {
    const curatorScopes = new Set(["storefront:homepage:stage"])
    resolvePrincipalMock.mockImplementation(
      ({ requiredScopes }: { requiredScopes: readonly string[] }) => {
        const missing = requiredScopes.filter(
          (scope) => !curatorScopes.has(scope),
        )
        if (missing.length > 0) {
          return Promise.reject(
            new AdminMcpAuthError(
              "insufficient_scope",
              `Missing ${missing.join(", ")}`,
              requiredScopes,
            ),
          )
        }
        return Promise.resolve({
          principal: { id: "user_1", role: "EDITOR" },
          token: { subject: "user_1", scopes: [...curatorScopes] },
        })
      },
    )

    const stage = await POST(
      post({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: "storefront.homepage.stage", arguments: {} },
      }),
    )
    expect(stage.status).toBe(200)
    expect(resolvePrincipalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requiredScopes: ["storefront:homepage:stage"],
      }),
    )

    for (const [name, requiredScope] of [
      ["experience.locale.update", "experience:locale:update"],
      ["experience.locale.discard", "experience:locale:update"],
      ["experience.locale.publish", "experience:publish"],
    ] as const) {
      const response = await POST(
        post({
          jsonrpc: "2.0",
          id: 21,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      )
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        error: "insufficient_scope",
        required_scopes: [requiredScope],
      })
    }
  })

  it("requires publish scope before dispatching the publish tool", async () => {
    const canonical = {
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
    }
    experienceLocaleFindUniqueOrThrow.mockResolvedValue(canonical)
    transactionMock.mockImplementationOnce(async (callback) =>
      callback({
        $queryRaw: vi.fn(),
        contentRevision: {
          findFirst: vi.fn().mockResolvedValue({
            id: "draft-1",
            snapshot: {
              v: 1,
              data: {
                slug: "esperanza",
                isHomepage: false,
                pathSegment: null,
                title: "Esperanza",
                metaDescription: null,
                ogTitle: null,
                ogDescription: null,
                ogImageUrl: null,
                blocks: [{ t: "text", heading: "Esperanza" }],
              },
            },
          }),
          create: vi.fn(),
          update: vi.fn(),
        },
        experienceLocale: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(canonical),
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
    const canonical = {
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
        archivedAt: null,
      },
    }
    experienceLocaleFindFirst.mockResolvedValueOnce(canonical)
    experienceLocaleFindUniqueOrThrow.mockResolvedValueOnce(canonical)

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
          ok: true,
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

  it("requires read and create scopes and duplicates every locale as a draft", async () => {
    experienceFindFirst.mockResolvedValueOnce({
      id: "exp-source",
      isTemplate: false,
      ownerId: "another-editor",
      archivedAt: null,
      locales: [
        {
          id: "loc-source",
          locale: "en",
          slug: "hope",
          isHomepage: true,
          pathSegment: null,
          title: "Hope",
          metaDescription: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          blocks: [],
          status: "PUBLISHED",
          publishedAt: new Date("2026-08-20T00:00:00.000Z"),
        },
      ],
    })
    experienceLocaleFindMany.mockResolvedValueOnce([])
    experienceCreate.mockResolvedValueOnce({
      id: "exp-copy",
      isTemplate: false,
      ownerId: "user_1",
      locales: [
        {
          id: "loc-copy",
          experienceId: "exp-copy",
          locale: "en",
          slug: "hope-copy",
          isHomepage: false,
          pathSegment: null,
          title: "Hope",
          metaDescription: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          blocks: [],
          status: "DRAFT",
          publishedAt: null,
          updatedAt: new Date("2026-08-21T12:00:00.000Z"),
        },
      ],
    })

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 45,
        method: "tools/call",
        params: {
          name: "experience.duplicate",
          arguments: { experienceId: "exp-source" },
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(resolvePrincipalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredScopes: ["experience:read", "experience:create"],
      }),
    )
    await expect(res.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          ok: true,
          sourceExperienceId: "exp-source",
          experience: { id: "exp-copy", ownerId: "user_1" },
          locales: [
            {
              id: "loc-copy",
              slug: "hope-copy",
              status: "DRAFT",
              publishedAt: null,
            },
          ],
        },
      },
    })
    expect(vi.mocked(emitRevalidateWebhook)).not.toHaveBeenCalled()
    expect(vi.mocked(refreshWatchRouteManifest)).not.toHaveBeenCalled()
  })

  it("rejects extra experience.duplicate arguments before reading the source", async () => {
    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 46,
        method: "tools/call",
        params: {
          name: "experience.duplicate",
          arguments: { experienceId: "exp-source", publish: true },
        },
      }),
    )

    await expect(res.json()).resolves.toMatchObject({
      error: { code: -32602, message: "Invalid tool arguments." },
    })
    expect(experienceFindFirst).not.toHaveBeenCalled()
    expect(experienceCreate).not.toHaveBeenCalled()
  })

  it("rejects an empty experience.duplicate id before reading the source", async () => {
    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 47,
        method: "tools/call",
        params: {
          name: "experience.duplicate",
          arguments: { experienceId: "" },
        },
      }),
    )

    await expect(res.json()).resolves.toMatchObject({
      error: { code: -32602, message: "Invalid tool arguments." },
    })
    expect(experienceFindFirst).not.toHaveBeenCalled()
    expect(experienceCreate).not.toHaveBeenCalled()
  })

  it("returns a safe domain error and creates nothing for an empty source", async () => {
    experienceFindFirst.mockResolvedValueOnce({
      id: "exp-empty",
      isTemplate: false,
      ownerId: "user_1",
      archivedAt: null,
      locales: [],
    })

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 47,
        method: "tools/call",
        params: {
          name: "experience.duplicate",
          arguments: { experienceId: "exp-empty" },
        },
      }),
    )

    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: -32000,
        message: "Experience cannot be duplicated from its current saved state",
      },
    })
    expect(experienceLocaleFindMany).not.toHaveBeenCalled()
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
          ok: false,
          reason: "slug_exists",
          conflict: {
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
        structuredContent: { ok: true },
      },
    })
    expect(experienceCreate).toHaveBeenCalled()
  })

  it("requires the generate scope and degrades to config_missing when mastra is unconfigured", async () => {
    // The test env carries no MASTRA_BASE_URL / MASTRA_SERVICE_API_KEY —
    // exactly an unprovisioned deployment. The tool must answer with a clean
    // typed envelope (HTTP 200), never a boot failure or thrown error.
    experienceLocaleFindFirst.mockResolvedValueOnce(null)

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 45,
        method: "tools/call",
        params: {
          name: "experience.generate",
          arguments: { topic: "Hope", locale: "en" },
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(resolvePrincipalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredScopes: ["experience:generate"],
      }),
    )
    await expect(res.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          ok: false,
          reason: "config_missing",
          retryable: false,
        },
      },
    })
    expect(experienceCreate).not.toHaveBeenCalled()
  })

  it("rejects experience.generate without the generate scope as HTTP 403", async () => {
    resolvePrincipalMock.mockRejectedValueOnce(
      new AdminMcpAuthError(
        "insufficient_scope",
        "Admin MCP token is missing required scope(s): experience:generate.",
        ["experience:generate"],
      ),
    )

    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 46,
        method: "tools/call",
        params: {
          name: "experience.generate",
          arguments: { topic: "Hope", locale: "en" },
        },
      }),
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: "insufficient_scope",
      required_scopes: ["experience:generate"],
    })
    expect(experienceLocaleFindFirst).not.toHaveBeenCalled()
    expect(experienceCreate).not.toHaveBeenCalled()
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
