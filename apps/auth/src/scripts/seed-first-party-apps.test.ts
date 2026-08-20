import { beforeEach, describe, expect, it, vi } from "vitest"

const upsertScope = vi.fn()
const upsertRegisteredApp = vi.fn()
const upsertAppEnvironment = vi.fn()
const upsertOAuthClient = vi.fn()
const findManyOAuthClients = vi.fn()
const updateOAuthClient = vi.fn()
const upsertOAuthResource = vi.fn()
const upsertOAuthClientResource = vi.fn()
const finalizeBetterAuth17Schema = vi.fn()

vi.mock("./finalize-better-auth-17-schema", () => ({
  finalizeBetterAuth17Schema,
}))

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
    oauthResource: { upsert: upsertOAuthResource },
    oauthClientResource: { upsert: upsertOAuthClientResource },
  },
}))

// Deliberately a literal, not an import: this is the WIRE value the TV sends as
// `grant_type` and the value `resolveDeviceClient` gates on. Keeping a hand-
// written copy here is what makes a rename of the shared constant go red
// instead of silently re-pointing producer and consumer together.
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const TV_CLIENT_IDS = [
  "jfp_tv_local",
  "jfp_tv_preview",
  "jfp_tv_staging",
  "jfp_tv_production",
]

type OAuthClientUpsertCall = {
  where: { clientId: string }
  create: { grantTypes: string[] }
  update: { grantTypes: string[] }
}

describe("seedFirstPartyApps", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertRegisteredApp.mockImplementation(async ({ where }) => ({
      id: `app_${where.key}`,
    }))
    findManyOAuthClients.mockResolvedValue([])
    finalizeBetterAuth17Schema.mockResolvedValue(undefined)
  })

  it("seeds scopes and OAuth clients for every first-party app", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    // admin 4 + manager 4 + web 4 + mastra-studio 4 + chat 2 + admin-mcp 5 +
    // mobile 2 + tv 4 = 29 environments; oauthClients adds the 4 manager
    // session-service clients on top.
    await expect(seedFirstPartyApps()).resolves.toEqual({
      apps: 8,
      environments: 29,
      oauthClients: 33,
      scopes: 21,
    })

    expect(finalizeBetterAuth17Schema).toHaveBeenCalledOnce()

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
          applicationType: "web",
          clientCredentialsScopes: [],
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
          applicationType: "web",
          clientCredentialsScopes: [],
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
          applicationType: "native",
          clientCredentialsScopes: [],
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
          applicationType: "web",
          clientCredentialsScopes: ["admin:manager-session:validate"],
          grantTypes: ["client_credentials"],
          disabled: true,
          metadata: expect.objectContaining({
            serviceAudience: "http://localhost:3003/api/manager/session",
          }),
        }),
      }),
    )
  })

  it("upserts native resources and client links without duplicate rows", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    await seedFirstPartyApps()
    await seedFirstPartyApps()

    expect(upsertOAuthResource).toHaveBeenCalledWith({
      where: { identifier: "https://admin.jesusfilm.org/mcp" },
      update: expect.objectContaining({ disabled: false }),
      create: expect.objectContaining({
        identifier: "https://admin.jesusfilm.org/mcp",
        allowedScopes: expect.arrayContaining(["experience:read"]),
      }),
    })
    expect(upsertOAuthClientResource).toHaveBeenCalledWith({
      where: {
        clientId_resourceId: {
          clientId: "jfp_admin_mcp_codex",
          resourceId: "https://admin.jesusfilm.org/mcp",
        },
      },
      update: {},
      create: {
        clientId: "jfp_admin_mcp_codex",
        resourceId: "https://admin.jesusfilm.org/mcp",
      },
    })
    expect(upsertOAuthClientResource).toHaveBeenCalledWith({
      where: {
        clientId_resourceId: {
          clientId: "jfp_manager_production_session_service",
          resourceId: "https://admin.jesusfilm.org/api/manager/session",
        },
      },
      update: {},
      create: {
        clientId: "jfp_manager_production_session_service",
        resourceId: "https://admin.jesusfilm.org/api/manager/session",
      },
    })
  })

  it("records the device grant type for every TV client in both upsert branches", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    await seedFirstPartyApps()

    const tvGrantTypes = [
      "authorization_code",
      "refresh_token",
      DEVICE_CODE_GRANT_TYPE,
    ]

    for (const clientId of TV_CLIENT_IDS) {
      expect(upsertOAuthClient).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId },
          create: expect.objectContaining({
            clientId,
            grantTypes: tvGrantTypes,
            scopes: [
              "openid",
              "profile:read",
              "email:read",
              "offline_access",
              "web:watch-events:write",
            ],
            public: true,
            requirePKCE: true,
            tokenEndpointAuthMethod: "none",
          }),
          // The update branch is what a re-deploy writes over an existing row;
          // a device grant recorded only on create never reaches a seeded env.
          update: expect.objectContaining({
            grantTypes: tvGrantTypes,
          }),
        }),
      )
    }
  })

  it("keeps the device grant type off every non-TV client", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    await seedFirstPartyApps()

    const calls = upsertOAuthClient.mock.calls.map(
      ([call]) => call as OAuthClientUpsertCall,
    )
    const nonTvCalls = calls.filter(
      (call) => !TV_CLIENT_IDS.includes(call.where.clientId),
    )
    const tvCalls = calls.filter((call) =>
      TV_CLIENT_IDS.includes(call.where.clientId),
    )

    // Anti-vacuous: both partitions must be populated, or "no non-TV client
    // carries the grant" would pass on an empty list.
    expect(tvCalls).toHaveLength(TV_CLIENT_IDS.length)
    expect(nonTvCalls.length).toBeGreaterThan(0)

    for (const call of nonTvCalls) {
      expect(call.create.grantTypes).not.toContain(DEVICE_CODE_GRANT_TYPE)
      expect(call.update.grantTypes).not.toContain(DEVICE_CODE_GRANT_TYPE)
    }
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
