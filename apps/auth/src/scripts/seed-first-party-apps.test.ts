import { beforeEach, describe, expect, it, vi } from "vitest"

const upsertScope = vi.fn()
const upsertRegisteredApp = vi.fn()
const upsertAppEnvironment = vi.fn()
const upsertOAuthClient = vi.fn()
const findManyOAuthClients = vi.fn()
const updateOAuthClient = vi.fn()

vi.mock("@/db/client", () => ({
  prisma: {
    scope: { upsert: upsertScope },
    registeredApp: { upsert: upsertRegisteredApp },
    appEnvironment: { upsert: upsertAppEnvironment },
    oauthClient: {
      findMany: findManyOAuthClients,
      update: updateOAuthClient,
      upsert: upsertOAuthClient,
    },
  },
}))

describe("seedFirstPartyApps", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertRegisteredApp.mockImplementation(async ({ where }) => ({
      id: `app_${where.key}`,
    }))
    findManyOAuthClients.mockResolvedValue([])
  })

  it("seeds scopes and OAuth clients for every first-party app", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    await expect(seedFirstPartyApps()).resolves.toEqual({
      apps: 6,
      environments: 23,
      oauthClients: 27,
      scopes: 21,
    })

    expect(upsertScope).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "manager:access" },
      }),
    )
    expect(upsertRegisteredApp).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "manager" },
        create: expect.objectContaining({
          key: "manager",
          displayName: "Jesus Film Manager",
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_manager_local" },
        create: expect.objectContaining({
          clientId: "jfp_manager_local",
          scopes: expect.arrayContaining(["manager:access"]),
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_mastra_studio_local" },
        create: expect.objectContaining({
          clientId: "jfp_mastra_studio_local",
          scopes: expect.arrayContaining(["mastra-studio:access"]),
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_web_local" },
        create: expect.objectContaining({
          clientId: "jfp_web_local",
          redirectUris: ["http://localhost:3000/watch/api/auth/callback"],
          scopes: expect.arrayContaining(["web:watch-events:write"]),
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
          metadata: expect.objectContaining({
            appKey: "web",
            environmentKey: "local",
          }),
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_chat_local" },
        create: expect.objectContaining({
          clientId: "jfp_chat_local",
          // Identity-only client — exact scope list, no *:access or
          // membership:read (feat-207 R7).
          scopes: ["openid", "profile:read", "email:read"],
          redirectUris: ["http://localhost:3200/api/auth/callback"],
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_admin_mcp_local" },
        create: expect.objectContaining({
          clientId: "jfp_admin_mcp_local",
          scopes: expect.arrayContaining([
            "offline_access",
            "experience:read",
            "experience:locale:create",
            "experience:locale:update",
            "experience:locale:validate",
            "media:read",
            "video:read",
            "bible:read",
            "experience:publish",
          ]),
          redirectUris: ["http://localhost:3003/mcp/oauth/callback"],
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
          metadata: expect.objectContaining({
            appKey: "admin-mcp",
            environmentKey: "local",
          }),
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_chat_production" },
        create: expect.objectContaining({
          clientId: "jfp_chat_production",
          // Identity-only client — exact scope list, no *:access or
          // membership:read (feat-207 R7).
          scopes: ["openid", "profile:read", "email:read"],
          redirectUris: ["https://chat.jesusfilm.ai/api/auth/callback"],
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
          metadata: expect.objectContaining({
            appKey: "chat",
            environmentKey: "production",
          }),
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_admin_mcp_codex" },
        create: expect.objectContaining({
          clientId: "jfp_admin_mcp_codex",
          scopes: [
            "openid",
            "profile:read",
            "email:read",
            "offline_access",
            "membership:read",
            "experience:read",
            "experience:locale:create",
            "experience:locale:update",
            "experience:locale:validate",
            "media:read",
            "video:read",
            "bible:read",
            "experience:publish",
            "experience:create",
            "experience:generate",
          ],
          redirectUris: [],
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
          grantTypes: ["authorization_code", "refresh_token"],
          metadata: expect.objectContaining({
            appKey: "admin-mcp",
            environmentKey: "codex",
            environmentKind: "production",
          }),
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_manager_local_session_service" },
        create: expect.objectContaining({
          clientId: "jfp_manager_local_session_service",
          scopes: ["admin:manager-session:validate"],
          public: false,
          requirePKCE: false,
          tokenEndpointAuthMethod: "client_secret_basic",
          grantTypes: ["client_credentials"],
          disabled: true,
          metadata: expect.objectContaining({
            serviceAudience: "http://localhost:3003/api/manager/session",
          }),
        }),
      }),
    )
  })

  it("appends offline_access to existing dynamic Codex MCP clients only", async () => {
    findManyOAuthClients.mockResolvedValue([
      {
        clientId: "dynamic_codex_1",
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: ["http://localhost:52123/auth/callback"],
        requirePKCE: true,
        scopes: [
          "openid",
          "profile:read",
          "email:read",
          "membership:read",
          "experience:read",
          "experience:locale:create",
          "experience:locale:update",
          "experience:locale:validate",
          "media:read",
          "video:read",
          "bible:read",
          "experience:publish",
        ],
        tokenEndpointAuthMethod: "none",
      },
      {
        clientId: "dynamic_codex_2",
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: ["http://127.0.0.1:52124/callback"],
        requirePKCE: null,
        scopes: [
          "openid",
          "profile:read",
          "email:read",
          "offline_access",
          "membership:read",
          "experience:read",
          "experience:locale:create",
          "experience:locale:update",
          "experience:locale:validate",
          "media:read",
          "video:read",
          "bible:read",
          "experience:publish",
        ],
        tokenEndpointAuthMethod: "none",
      },
      {
        clientId: "not_codex_redirect",
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: ["https://example.com/callback"],
        requirePKCE: true,
        scopes: [
          "openid",
          "profile:read",
          "email:read",
          "membership:read",
          "experience:read",
          "experience:locale:create",
          "experience:locale:update",
          "experience:locale:validate",
          "media:read",
          "video:read",
          "bible:read",
          "experience:publish",
        ],
        tokenEndpointAuthMethod: "none",
      },
      {
        clientId: "not_pkce",
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: ["http://localhost:52125/auth/callback"],
        requirePKCE: false,
        scopes: [
          "openid",
          "profile:read",
          "email:read",
          "membership:read",
          "experience:read",
          "experience:locale:create",
          "experience:locale:update",
          "experience:locale:validate",
          "media:read",
          "video:read",
          "bible:read",
          "experience:publish",
        ],
        tokenEndpointAuthMethod: "none",
      },
    ])

    const { seedFirstPartyApps } = await import("./seed-first-party-apps")
    await seedFirstPartyApps()

    expect(findManyOAuthClients).toHaveBeenCalledWith({
      where: {
        public: true,
        tokenEndpointAuthMethod: "none",
        grantTypes: { hasEvery: ["authorization_code", "refresh_token"] },
        scopes: { hasEvery: expect.arrayContaining(["experience:read"]) },
      },
      select: {
        clientId: true,
        grantTypes: true,
        redirectUris: true,
        requirePKCE: true,
        scopes: true,
        tokenEndpointAuthMethod: true,
      },
    })
    expect(updateOAuthClient).toHaveBeenCalledTimes(1)
    expect(updateOAuthClient).toHaveBeenCalledWith({
      where: { clientId: "dynamic_codex_1" },
      data: {
        scopes: [
          "openid",
          "profile:read",
          "email:read",
          "membership:read",
          "experience:read",
          "experience:locale:create",
          "experience:locale:update",
          "experience:locale:validate",
          "media:read",
          "video:read",
          "bible:read",
          "experience:publish",
          "offline_access",
        ],
      },
    })
  })
})
