import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ADMIN_MCP_DEFAULT_SCOPES,
  CHANGELOG_DEFAULT_SCOPES,
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

describe("seedFirstPartyApps", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertRegisteredApp.mockImplementation(async ({ where }) => ({
      id: `app_${where.key}`,
    }))
    findManyOAuthClients.mockResolvedValue([])
    findManyOAuthResources.mockResolvedValue(PUBLIC_RESOURCE_ROWS)
    finalizeBetterAuth17Schema.mockResolvedValue(undefined)
  })

  it("seeds scopes and OAuth clients for every first-party app", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    // admin 4 + manager 4 + web 4 + mastra-studio 4 + chat 2 + changelog 2 +
    // admin-mcp 5 + mobile 2 + tv 4 = 31 environments; oauthClients adds the 4 manager
    // session-service clients on top.
    await expect(seedFirstPartyApps()).resolves.toEqual({
      apps: 9,
      environments: 31,
      oauthClients: 35,
      scopes: 24,
      resourceRepair: {
        createdLinks: 0,
        eligibleClients: 0,
        offlineAccessUpdatedClients: 0,
        repairedClients: 0,
      },
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
      eligibleLoopbackClient({ clientId: "dynamic_loopback_1" }),
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
          disabled: false,
          grantTypes: {
            hasEvery: ["authorization_code", "refresh_token"],
          },
          public: true,
          tokenEndpointAuthMethod: "none",
        }),
      }),
    )
    expect(transaction).toHaveBeenCalledOnce()
    expect(result.resourceRepair).toEqual({
      createdLinks: PUBLIC_RESOURCE_ROWS.length,
      eligibleClients: 1,
      offlineAccessUpdatedClients: 0,
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
      repairedClients: 1,
    })
    expect(second.resourceRepair).toEqual({
      createdLinks: 0,
      eligibleClients: 1,
      offlineAccessUpdatedClients: 0,
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
      "Public OAuth resource seed invariant failed (5/6 scope-compatible rows)",
    )

    expect(findManyOAuthClients).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})
