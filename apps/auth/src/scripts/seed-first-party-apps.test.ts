import { beforeEach, describe, expect, it, vi } from "vitest"

const upsertScope = vi.fn()
const upsertRegisteredApp = vi.fn()
const upsertAppEnvironment = vi.fn()
const upsertOAuthClient = vi.fn()

vi.mock("@/db/client", () => ({
  prisma: {
    scope: { upsert: upsertScope },
    registeredApp: { upsert: upsertRegisteredApp },
    appEnvironment: { upsert: upsertAppEnvironment },
    oauthClient: { upsert: upsertOAuthClient },
  },
}))

describe("seedFirstPartyApps", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertRegisteredApp.mockImplementation(async ({ where }) => ({
      id: `app_${where.key}`,
    }))
  })

  it("seeds scopes and OAuth clients for every first-party app", async () => {
    const { seedFirstPartyApps } = await import("./seed-first-party-apps")

    await expect(seedFirstPartyApps()).resolves.toEqual({
      apps: 4,
      environments: 16,
      oauthClients: 20,
      scopes: 10,
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
})
