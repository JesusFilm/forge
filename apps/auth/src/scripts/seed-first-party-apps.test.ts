import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ADMIN_MCP_DEFAULT_SCOPES,
  CHANGELOG_DEFAULT_SCOPES,
  FIRST_PARTY_OAUTH_CLIENT_IDS,
  STUDIO_MCP_APP_SEED,
  STUDIO_MCP_RESOURCE_SCOPES,
  STUDIO_CHATGPT_CLIENT_ID,
  STUDIO_CHATGPT_CALLBACK,
  STUDIO_CHATGPT_SCOPES,
} from "@/domain/apps"

const upsertScope = vi.fn()
const upsertRegisteredApp = vi.fn()
const upsertAppEnvironment = vi.fn()
const upsertOAuthClient = vi.fn()
const findManyOAuthClients = vi.fn()
const updateOAuthClient = vi.fn()
const upsertOAuthResource = vi.fn()
const findManyOAuthResources = vi.fn()
const upsertOAuthClientResource = vi.fn()
const transaction = vi.fn(async (callback) =>
  callback({ oauthClientResource: { upsert: upsertOAuthClientResource } }),
)
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
    oauthResource: {
      findMany: findManyOAuthResources,
      upsert: upsertOAuthResource,
    },
    oauthClientResource: { upsert: upsertOAuthClientResource },
    $transaction: transaction,
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
const PUBLIC_RESOURCE_ROWS: Array<{
  allowedScopes: string[]
  disabled: boolean
  identifier: string
}> = [
  ...STUDIO_MCP_APP_SEED.environments
    .filter((e) => e.key !== "chatgpt")
    .map((e) => ({
      identifier: e.mcpResourceAudience!,
      disabled: false,
      allowedScopes: [...STUDIO_MCP_RESOURCE_SCOPES],
    })),
  ...[
    "http://localhost:3003/mcp",
    "https://admin-preview.jesusfilm.org/mcp",
    "https://admin-stage.jesusfilm.org/mcp",
    "https://admin.jesusfilm.org/mcp",
  ].map((identifier) => ({
    allowedScopes: [...ADMIN_MCP_DEFAULT_SCOPES],
    disabled: false,
    identifier,
  })),
  ...["http://localhost:3000/mcp", "https://changelog.jesusfilm.org/mcp"].map(
    (identifier) => ({
      allowedScopes: [...CHANGELOG_DEFAULT_SCOPES],
      disabled: false,
      identifier,
    }),
  ),
]

type OAuthClientUpsertCall = {
  where: { clientId: string }
  create: { grantTypes: string[] }
  update: { grantTypes: string[] }
}

function eligibleLoopbackClient(
  overrides: Partial<{
    applicationType: string | null
    clientId: string
    clientSecret: string | null
    disabled: boolean
    grantTypes: string[]
    public: boolean | null
    redirectUris: string[]
    requirePKCE: boolean | null
    resourceLinks: Array<{ resourceId: string }>
    scopes: string[]
    tokenEndpointAuthMethod: string | null
  }> = {},
) {
  return {
    applicationType: "native",
    clientId: "dynamic_loopback",
    clientSecret: null,
    disabled: false,
    grantTypes: ["authorization_code", "refresh_token"],
    public: true,
    redirectUris: ["http://localhost:52123/auth/callback"],
    requirePKCE: true,
    resourceLinks: [],
    scopes: ["openid"],
    tokenEndpointAuthMethod: "none",
    ...overrides,
  }
}

const PUSH_CAMPAIGN_SCOPES = ["push:campaign:read", "push:campaign:draft"]
// Literal on purpose: Better Auth 1.7.1 wrote this whole public-DCR union onto
// every dynamic client that registered before the push scopes joined it.
const PRE_PUSH_PUBLIC_DCR_SCOPE_UNION = [
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
  "changelog:read",
  "changelog:submit",
  "changelog:admin",
  "shorts:read",
  "shorts:edit",
  "shorts:render",
  "shorts:chat",
  "shorts:narration",
  "shorts:instructions:read",
]
// The Admin MCP default list that Better Auth 1.6.2 clients registered with.
const LEGACY_ADMIN_MCP_SCOPES = [
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
]

type OAuthClientRow = ReturnType<typeof eligibleLoopbackClient>

// A stand-in oauth_client table: later seed steps read earlier writes. It
// ignores `where`, so the push query's real filter is pinned in its own test.
function useOAuthClientTable(rows: OAuthClientRow[]) {
  findManyOAuthClients.mockImplementation(async () =>
    rows.map((row) => ({ ...row, scopes: [...row.scopes] })),
  )
  updateOAuthClient.mockImplementation(async ({ where, data }) => {
    const row = rows.find(({ clientId }) => clientId === where.clientId)
    if (row) Object.assign(row, data)
    return row
  })
  return rows
}

describe("seedFirstPartyApps", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertRegisteredApp.mockImplementation(async ({ where }) => ({
      id: `app_${where.key}`,
    }))
    findManyOAuthClients.mockResolvedValue([])
    updateOAuthClient.mockResolvedValue(undefined)
    findManyOAuthResources.mockResolvedValue(PUBLIC_RESOURCE_ROWS)
    finalizeBetterAuth17Schema.mockResolvedValue(undefined)
  })

  it("seeds scopes and OAuth clients for every first-party app", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    // shorts-mcp 5 + admin 4 + manager 4 + web 4 + mastra-studio 4 + chat 2 +
    // changelog 2 + admin-mcp 5 + mobile 2 + tv 4 = 36 environments across 10
    // apps; oauthClients adds the 4 manager session-service clients on top.
    await expect(seedFirstPartyApps()).resolves.toEqual({
      apps: 10,
      environments: 36,
      oauthClients: 40,
      // Includes separate Shorts render and narration consent scopes.
      scopes: 33,
      resourceRepair: {
        createdLinks: 0,
        eligibleClients: 0,
        offlineAccessUpdatedClients: 0,
        pushScopesUpdatedClients: 0,
        repairedClients: 0,
      },
    })

    expect(finalizeBetterAuth17Schema).toHaveBeenCalledOnce()

    for (const key of [
      "shorts:render",
      "shorts:narration",
      "push:campaign:read",
      "push:campaign:draft",
    ]) {
      expect(upsertScope).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key } }),
      )
    }

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
        where: { clientId: "jfp_changelog_local" },
        create: expect.objectContaining({
          clientId: "jfp_changelog_local",
          redirectUris: ["http://localhost:3000/api/auth/callback"],
          postLogoutRedirectUris: ["http://localhost:3000/api/auth/login"],
          scopes: [
            "openid",
            "profile:read",
            "email:read",
            "membership:read",
            "changelog:read",
            "changelog:submit",
            "changelog:admin",
          ],
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
          grantTypes: ["authorization_code", "refresh_token"],
          metadata: expect.objectContaining({
            appKey: "changelog",
            environmentKey: "local",
          }),
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_changelog_production" },
        create: expect.objectContaining({
          clientId: "jfp_changelog_production",
          redirectUris: ["https://changelog.jesusfilm.org/api/auth/callback"],
          postLogoutRedirectUris: [
            "https://changelog.jesusfilm.org/api/auth/login",
          ],
          scopes: [
            "openid",
            "profile:read",
            "email:read",
            "membership:read",
            "changelog:read",
            "changelog:submit",
            "changelog:admin",
          ],
          public: true,
          requirePKCE: true,
          tokenEndpointAuthMethod: "none",
          grantTypes: ["authorization_code", "refresh_token"],
          metadata: expect.objectContaining({
            appKey: "changelog",
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
            "push:campaign:read",
            "push:campaign:draft",
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
          scopes: ["admin:manager-session:validate", "admin:manager-backend"],
          public: false,
          requirePKCE: false,
          tokenEndpointAuthMethod: "client_secret_basic",
          applicationType: "web",
          clientCredentialsScopes: [
            "admin:manager-session:validate",
            "admin:manager-backend",
          ],
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
      where: { identifier: "http://localhost:3003/api/manager/session" },
      update: expect.objectContaining({
        allowedScopes: [
          "admin:manager-session:validate",
          "admin:manager-backend",
        ],
        disabled: false,
      }),
      create: expect.objectContaining({
        identifier: "http://localhost:3003/api/manager/session",
        allowedScopes: [
          "admin:manager-session:validate",
          "admin:manager-backend",
        ],
      }),
    })
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
    expect(upsertOAuthResource).toHaveBeenCalledWith({
      where: { identifier: "http://localhost:3000/mcp" },
      update: expect.objectContaining({
        allowedScopes: expect.arrayContaining(["changelog:read"]),
        disabled: false,
      }),
      create: expect.objectContaining({
        identifier: "http://localhost:3000/mcp",
        allowedScopes: expect.arrayContaining(["changelog:read"]),
      }),
    })
    expect(upsertOAuthClientResource).toHaveBeenCalledWith({
      where: {
        clientId_resourceId: {
          clientId: "jfp_changelog_local",
          resourceId: "http://localhost:3000/mcp",
        },
      },
      update: {},
      create: {
        clientId: "jfp_changelog_local",
        resourceId: "http://localhost:3000/mcp",
      },
    })
    expect(upsertOAuthClientResource).toHaveBeenCalledWith({
      where: {
        clientId_resourceId: {
          clientId: "jfp_changelog_production",
          resourceId: "https://changelog.jesusfilm.org/mcp",
        },
      },
      update: {},
      create: {
        clientId: "jfp_changelog_production",
        resourceId: "https://changelog.jesusfilm.org/mcp",
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

  it("reuses the same Changelog upsert keys on repeated seeding", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    await seedFirstPartyApps()
    await seedFirstPartyApps()

    for (const clientId of [
      "jfp_changelog_local",
      "jfp_changelog_production",
    ]) {
      const calls = upsertOAuthClient.mock.calls.filter(
        ([call]) => call.where.clientId === clientId,
      )
      expect(calls).toHaveLength(2)
      for (const [call] of calls) {
        expect(call.create).not.toHaveProperty("clientSecret")
        expect(call.update).not.toHaveProperty("clientSecret")
      }
    }
    expect(
      upsertRegisteredApp.mock.calls.filter(
        ([call]) => call.where.key === "changelog",
      ),
    ).toHaveLength(2)
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

  it("repairs every public MCP link for an eligible existing loopback client transactionally", async () => {
    findManyOAuthClients.mockResolvedValue([
      eligibleLoopbackClient({
        clientId: "dynamic_loopback_1",
        public: null,
      }),
    ])

    const { seedFirstPartyApps } = await import("./seed-first-party-apps")
    const result = await seedFirstPartyApps()

    expect(findManyOAuthResources).toHaveBeenCalledWith({
      where: {
        identifier: {
          in: expect.arrayContaining(
            PUBLIC_RESOURCE_ROWS.map(({ identifier }) => identifier),
          ),
        },
      },
      select: { allowedScopes: true, disabled: true, identifier: true },
    })
    expect(findManyOAuthResources.mock.invocationCallOrder[0]).toBeLessThan(
      findManyOAuthClients.mock.invocationCallOrder[0],
    )
    expect(findManyOAuthClients).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          applicationType: "native",
          clientSecret: null,
          disabled: false,
          grantTypes: {
            hasEvery: ["authorization_code", "refresh_token"],
          },
          OR: [{ public: true }, { public: null }],
          tokenEndpointAuthMethod: "none",
        }),
      }),
    )
    expect(transaction).toHaveBeenCalledOnce()
    expect(result.resourceRepair).toEqual({
      createdLinks: PUBLIC_RESOURCE_ROWS.length,
      eligibleClients: 1,
      offlineAccessUpdatedClients: 0,
      pushScopesUpdatedClients: 0,
      repairedClients: 1,
    })
    expect(upsertOAuthClientResource).toHaveBeenCalledWith({
      where: {
        clientId_resourceId: {
          clientId: "dynamic_loopback_1",
          resourceId: "https://admin.jesusfilm.org/mcp",
        },
      },
      update: {},
      create: {
        clientId: "dynamic_loopback_1",
        resourceId: "https://admin.jesusfilm.org/mcp",
      },
    })
    expect(upsertOAuthClientResource).toHaveBeenCalledWith({
      where: {
        clientId_resourceId: {
          clientId: "dynamic_loopback_1",
          resourceId: "https://changelog.jesusfilm.org/mcp",
        },
      },
      update: {},
      create: {
        clientId: "dynamic_loopback_1",
        resourceId: "https://changelog.jesusfilm.org/mcp",
      },
    })
  })

  it("excludes seeded, confidential, non-loopback, disabled, PKCE-disabled, web, and incomplete clients", async () => {
    findManyOAuthClients.mockResolvedValue([
      eligibleLoopbackClient({ clientId: "jfp_admin_mcp_codex" }),
      eligibleLoopbackClient({ clientId: "confidential", public: false }),
      eligibleLoopbackClient({
        clientId: "remote",
        redirectUris: ["https://example.com/callback"],
      }),
      eligibleLoopbackClient({ clientId: "disabled", disabled: true }),
      eligibleLoopbackClient({ clientId: "no_pkce", requirePKCE: false }),
      eligibleLoopbackClient({
        clientId: "web_client",
        applicationType: "web",
      }),
      eligibleLoopbackClient({
        clientId: "missing_refresh",
        grantTypes: ["authorization_code"],
      }),
      eligibleLoopbackClient({
        clientId: "changelog_only",
        redirectUris: ["http://127.0.0.1:61234/callback"],
        scopes: [...CHANGELOG_DEFAULT_SCOPES],
      }),
    ])

    const { seedFirstPartyApps } = await import("./seed-first-party-apps")
    const result = await seedFirstPartyApps()

    expect(result.resourceRepair).toEqual({
      createdLinks: PUBLIC_RESOURCE_ROWS.length,
      eligibleClients: 1,
      offlineAccessUpdatedClients: 0,
      pushScopesUpdatedClients: 0,
      repairedClients: 1,
    })
    expect(transaction).toHaveBeenCalledOnce()
    const repairedClientIds = upsertOAuthClientResource.mock.calls
      .map(([call]) => call.create.clientId)
      .filter((clientId) => !clientId.startsWith("jfp_"))
    expect(new Set(repairedClientIds)).toEqual(new Set(["changelog_only"]))
    expect(updateOAuthClient).not.toHaveBeenCalled()
  })

  it("adds only missing links and is a no-op when repeated against repaired state", async () => {
    let resourceLinks = [{ resourceId: "https://admin.jesusfilm.org/mcp" }]
    findManyOAuthClients.mockImplementation(async ({ where }) =>
      where.scopes
        ? []
        : [
            eligibleLoopbackClient({
              clientId: "dynamic_partial",
              resourceLinks,
            }),
          ],
    )

    const { seedFirstPartyApps } = await import("./seed-first-party-apps")
    const first = await seedFirstPartyApps()
    resourceLinks = PUBLIC_RESOURCE_ROWS.map(({ identifier: resourceId }) => ({
      resourceId,
    }))
    const second = await seedFirstPartyApps()

    expect(first.resourceRepair).toEqual({
      createdLinks: PUBLIC_RESOURCE_ROWS.length - 1,
      eligibleClients: 1,
      offlineAccessUpdatedClients: 0,
      pushScopesUpdatedClients: 0,
      repairedClients: 1,
    })
    expect(second.resourceRepair).toEqual({
      createdLinks: 0,
      eligibleClients: 1,
      offlineAccessUpdatedClients: 0,
      pushScopesUpdatedClients: 0,
      repairedClients: 0,
    })
    expect(transaction).toHaveBeenCalledOnce()
    expect(upsertOAuthClientResource).not.toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          clientId: "dynamic_partial",
          resourceId: "https://admin.jesusfilm.org/mcp",
        },
      }),
    )
  })

  it("aborts startup from the per-client transaction when a link write fails", async () => {
    findManyOAuthClients.mockResolvedValue([
      eligibleLoopbackClient({ clientId: "dynamic_failure" }),
    ])
    const transactionalUpsert = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("simulated link failure"))
    transaction.mockImplementationOnce(async (callback) =>
      callback({ oauthClientResource: { upsert: transactionalUpsert } }),
    )

    const { seedFirstPartyApps } = await import("./seed-first-party-apps")
    await expect(seedFirstPartyApps()).rejects.toThrow("simulated link failure")

    expect(transaction).toHaveBeenCalledOnce()
    expect(transactionalUpsert).toHaveBeenCalledTimes(2)
    expect(updateOAuthClient).not.toHaveBeenCalled()
  })

  it("stops before client repair when a public resource row is missing or has stale scopes", async () => {
    findManyOAuthResources.mockResolvedValue([
      ...PUBLIC_RESOURCE_ROWS.slice(0, -1),
      {
        ...PUBLIC_RESOURCE_ROWS.at(-1),
        allowedScopes: ["openid"],
      },
    ])
    findManyOAuthClients.mockResolvedValue([eligibleLoopbackClient()])

    const { seedFirstPartyApps } = await import("./seed-first-party-apps")
    await expect(seedFirstPartyApps()).rejects.toThrow(
      "Public OAuth resource seed invariant failed (9/10 scope-compatible rows)",
    )

    expect(findManyOAuthClients).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it("rejects duplicate scopes even when the resource row length still matches", async () => {
    const first = PUBLIC_RESOURCE_ROWS[0]
    if (!first) throw new Error("Expected a public OAuth resource fixture")
    const duplicatedScopes = [...first.allowedScopes]
    duplicatedScopes[duplicatedScopes.length - 1] = duplicatedScopes[0]!
    findManyOAuthResources.mockResolvedValue([
      { ...first, allowedScopes: duplicatedScopes },
      ...PUBLIC_RESOURCE_ROWS.slice(1),
    ])

    const { seedFirstPartyApps } = await import("./seed-first-party-apps")
    await expect(seedFirstPartyApps()).rejects.toThrow(
      "Public OAuth resource seed invariant failed (9/10 scope-compatible rows)",
    )

    expect(findManyOAuthClients).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it("seeds a dedicated consented ChatGPT client without changing Manager callback or resource ceiling", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")
    await seedFirstPartyApps()
    const expected = {
      redirectUris: [STUDIO_CHATGPT_CALLBACK],
      scopes: STUDIO_CHATGPT_SCOPES,
      public: true,
      requirePKCE: true,
      tokenEndpointAuthMethod: "none",
      applicationType: "web",
      skipConsent: false,
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      clientCredentialsScopes: [],
    }
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: STUDIO_CHATGPT_CLIENT_ID },
        create: expect.objectContaining(expected),
        update: expect.objectContaining(expected),
      }),
    )
    expect(upsertAppEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          key: "chatgpt",
          kind: "PRODUCTION",
          autoApprove: false,
          status: "APPROVED",
        }),
      }),
    )
    expect(upsertOAuthClientResource).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          clientId: STUDIO_CHATGPT_CLIENT_ID,
          resourceId: "https://manager.jesusfilm.org/mcp",
        },
      }),
    )
    expect(upsertOAuthResource).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identifier: "https://manager.jesusfilm.org/mcp" },
        update: expect.objectContaining({
          allowedScopes: STUDIO_MCP_RESOURCE_SCOPES,
        }),
      }),
    )
    expect(upsertOAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "jfp_shorts_mcp_production" },
        update: expect.objectContaining({
          redirectUris: ["https://manager.jesusfilm.org/mcp/oauth/callback"],
        }),
      }),
    )
  })

  describe("push campaign scope migration", () => {
    it("adds both push scopes to a Better Auth 1.7.1 dynamic registration row", async () => {
      const [row] = useOAuthClientTable([
        eligibleLoopbackClient({
          clientId: "dcr_better_auth_171",
          public: null,
          requirePKCE: null,
          scopes: [...PRE_PUSH_PUBLIC_DCR_SCOPE_UNION],
        }),
      ])

      const { seedFirstPartyApps } = await import("./seed-first-party-apps")
      const result = await seedFirstPartyApps()

      expect(row?.scopes).toEqual([
        ...PRE_PUSH_PUBLIC_DCR_SCOPE_UNION,
        ...PUSH_CAMPAIGN_SCOPES,
      ])
      expect(result.resourceRepair).toMatchObject({
        offlineAccessUpdatedClients: 0,
        pushScopesUpdatedClients: 1,
      })
    })

    it("queries public true or null clients and leaves the PKCE check to code", async () => {
      // A `public: true` or `requirePKCE: true` filter here would match no
      // Better Auth 1.7.1 row in a real database, and the fake table cannot see it.
      const { seedFirstPartyApps } = await import("./seed-first-party-apps")
      await seedFirstPartyApps()

      expect(findManyOAuthClients).toHaveBeenCalledWith({
        where: {
          clientId: { notIn: FIRST_PARTY_OAUTH_CLIENT_IDS },
          clientSecret: null,
          disabled: false,
          OR: [{ public: true }, { public: null }],
          scopes: { has: "experience:read" },
          NOT: { scopes: { hasEvery: PUSH_CAMPAIGN_SCOPES } },
          tokenEndpointAuthMethod: "none",
        },
        select: {
          clientId: true,
          clientSecret: true,
          disabled: true,
          public: true,
          requirePKCE: true,
          scopes: true,
          tokenEndpointAuthMethod: true,
        },
      })
    })

    it("adds both push scopes to a legacy Better Auth 1.6.2 row and keeps the offline_access repair", async () => {
      const [row] = useOAuthClientTable([
        eligibleLoopbackClient({
          clientId: "dcr_better_auth_162",
          public: true,
          requirePKCE: true,
          scopes: [...LEGACY_ADMIN_MCP_SCOPES],
        }),
      ])

      const { seedFirstPartyApps } = await import("./seed-first-party-apps")
      const result = await seedFirstPartyApps()

      expect(row?.scopes).toEqual([
        ...LEGACY_ADMIN_MCP_SCOPES,
        "offline_access",
        ...PUSH_CAMPAIGN_SCOPES,
      ])
      expect(result.resourceRepair).toMatchObject({
        offlineAccessUpdatedClients: 1,
        pushScopesUpdatedClients: 1,
      })
    })

    it("does not change confidential, first-party, disabled, PKCE-off, or non-Experience clients", async () => {
      const scopes = [...PRE_PUSH_PUBLIC_DCR_SCOPE_UNION]
      const rows = useOAuthClientTable([
        eligibleLoopbackClient({
          clientId: "eligible",
          public: null,
          requirePKCE: null,
          scopes,
        }),
        eligibleLoopbackClient({ clientId: "jfp_admin_mcp_codex", scopes }),
        eligibleLoopbackClient({
          clientId: "with_secret",
          clientSecret: "hashed-secret",
          scopes,
        }),
        eligibleLoopbackClient({
          clientId: "secret_basic",
          tokenEndpointAuthMethod: "client_secret_basic",
          scopes,
        }),
        eligibleLoopbackClient({
          clientId: "not_public",
          public: false,
          scopes,
        }),
        eligibleLoopbackClient({
          clientId: "pkce_off",
          requirePKCE: false,
          scopes,
        }),
        eligibleLoopbackClient({
          clientId: "disabled",
          disabled: true,
          scopes,
        }),
        eligibleLoopbackClient({
          clientId: "changelog_only",
          scopes: [...CHANGELOG_DEFAULT_SCOPES],
        }),
      ])
      const before = structuredClone(rows)

      const { seedFirstPartyApps } = await import("./seed-first-party-apps")
      const result = await seedFirstPartyApps()

      expect(result.resourceRepair.pushScopesUpdatedClients).toBe(1)
      expect(updateOAuthClient).toHaveBeenCalledOnce()
      expect(updateOAuthClient).toHaveBeenCalledWith({
        where: { clientId: "eligible" },
        data: { scopes: [...scopes, ...PUSH_CAMPAIGN_SCOPES] },
      })
      expect(rows.slice(1)).toEqual(before.slice(1))
    })

    it("skips push query rows with an unexpected shape without throwing", async () => {
      const posture = eligibleLoopbackClient({
        scopes: [...PRE_PUSH_PUBLIC_DCR_SCOPE_UNION],
      })
      const rows: unknown[] = [
        {},
        { ...posture, clientId: "scopes_null", scopes: null },
        { ...posture, clientId: "scopes_string", scopes: "experience:read" },
        {
          ...posture,
          clientId: "scopes_null_entry",
          scopes: ["experience:read", null],
        },
        { ...posture, clientId: "well_formed" },
      ]
      findManyOAuthClients.mockImplementation(async ({ where }) =>
        where.scopes?.has === "experience:read" ? rows : [],
      )

      const { seedFirstPartyApps } = await import("./seed-first-party-apps")
      const result = await seedFirstPartyApps()

      expect(result.resourceRepair.pushScopesUpdatedClients).toBe(1)
      expect(updateOAuthClient).toHaveBeenCalledOnce()
      expect(updateOAuthClient).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clientId: "well_formed" } }),
      )
    })

    it("prints the push scope count in the summary line without client ids", async () => {
      useOAuthClientTable([
        eligibleLoopbackClient({
          clientId: "dcr_summary_probe",
          public: null,
          requirePKCE: null,
          scopes: [...PRE_PUSH_PUBLIC_DCR_SCOPE_UNION],
        }),
      ])

      const { formatSeedSummary, seedFirstPartyApps } =
        await import("./seed-first-party-apps")
      const summary = formatSeedSummary(await seedFirstPartyApps())

      expect(summary).toContain(
        "1 dynamic clients updated for push campaign scopes",
      )
      expect(summary).not.toContain("dcr_summary_probe")
    })

    it("changes nothing on a second run", async () => {
      const rows = useOAuthClientTable([
        eligibleLoopbackClient({
          clientId: "dcr_better_auth_171",
          public: null,
          requirePKCE: null,
          scopes: [...PRE_PUSH_PUBLIC_DCR_SCOPE_UNION],
        }),
        eligibleLoopbackClient({
          clientId: "dcr_better_auth_162",
          scopes: [...LEGACY_ADMIN_MCP_SCOPES],
        }),
      ])

      const { seedFirstPartyApps } = await import("./seed-first-party-apps")
      const first = await seedFirstPartyApps()
      const afterFirst = structuredClone(rows)
      updateOAuthClient.mockClear()
      const second = await seedFirstPartyApps()

      expect(first.resourceRepair.pushScopesUpdatedClients).toBe(2)
      expect(second.resourceRepair).toMatchObject({
        offlineAccessUpdatedClients: 0,
        pushScopesUpdatedClients: 0,
      })
      expect(updateOAuthClient).not.toHaveBeenCalled()
      expect(rows).toEqual(afterFirst)
    })
  })
})
