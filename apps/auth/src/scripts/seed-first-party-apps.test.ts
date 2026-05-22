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
      apps: 3,
      environments: 12,
      oauthClients: 12,
      scopes: 8,
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
  })
})
