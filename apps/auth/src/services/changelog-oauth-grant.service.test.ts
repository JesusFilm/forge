import { describe, expect, it, vi } from "vitest"

import { createChangelogOAuthGrantDecision } from "./changelog-oauth-grant.service"

const prismaMocks = vi.hoisted(() => ({
  findClientEnvironment: vi.fn(),
  findTargetEnvironment: vi.fn(),
  findApprovedUserGrants: vi.fn(),
}))

vi.mock("@/db/client", () => ({
  prisma: {
    appEnvironment: {
      findUnique: prismaMocks.findClientEnvironment,
      findFirst: prismaMocks.findTargetEnvironment,
    },
    appGrant: { findMany: prismaMocks.findApprovedUserGrants },
  },
}))

vi.mock("@/config/env", () => ({
  isChangelogProductionEnabled: () => false,
}))

type TestEnvironment = {
  id: string
  kind: "LOCAL" | "PRODUCTION" | "PREVIEW" | "STAGING"
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED"
  app: {
    id: string
    key: string
    status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"
  }
}

const localEnvironment: TestEnvironment = {
  id: "environment_local",
  kind: "LOCAL" as const,
  status: "APPROVED" as const,
  app: { id: "app_changelog", key: "changelog", status: "ACTIVE" as const },
}

function dependencies({
  clientEnvironment = localEnvironment as TestEnvironment | null,
  targetEnvironment = localEnvironment as TestEnvironment | null,
  grants = [] as { scopes: { scope: { key: string } }[] }[],
  productionEnabled = false,
} = {}) {
  return {
    findClientEnvironment: vi.fn(async () => clientEnvironment),
    findTargetEnvironment: vi.fn(async () => targetEnvironment),
    findApprovedUserGrants: vi.fn(async () => grants),
    productionEnabled: vi.fn(() => productionEnabled),
  }
}

const authorizationInput = {
  lifecycle: "authorization" as const,
  userId: "user_1",
  membershipStatus: "ACTIVE" as const,
  clientId: "jfp_changelog_local",
  requestedScopes: [
    "openid",
    "changelog:read",
    "changelog:submit",
    "changelog:admin",
  ],
  resources: [] as string[],
}

describe("Changelog OAuth grant decision", () => {
  it("pins the default Prisma query to the exact active user tuple", async () => {
    prismaMocks.findClientEnvironment.mockResolvedValueOnce(localEnvironment)
    prismaMocks.findApprovedUserGrants.mockResolvedValueOnce([
      { scopes: [{ scope: { key: "changelog:read" } }] },
    ])

    await expect(
      createChangelogOAuthGrantDecision(authorizationInput),
    ).resolves.toMatchObject({
      allowed: true,
      scopes: ["openid", "changelog:read"],
    })
    expect(prismaMocks.findApprovedUserGrants).toHaveBeenCalledWith({
      where: {
        appId: "app_changelog",
        environmentId: "environment_local",
        subjectType: "USER",
        userId: "user_1",
        status: "APPROVED",
        revokedAt: null,
      },
      select: {
        scopes: { select: { scope: { select: { key: true } } } },
      },
    })
  })

  it("aggregates only matching approved, non-revoked user grant scopes", async () => {
    const deps = dependencies({
      grants: [
        { scopes: [{ scope: { key: "changelog:read" } }] },
        { scopes: [{ scope: { key: "changelog:submit" } }] },
      ],
    })

    await expect(
      createChangelogOAuthGrantDecision(authorizationInput, deps),
    ).resolves.toEqual({
      allowed: true,
      scopes: ["openid", "changelog:read", "changelog:submit"],
      target: {
        dynamicClient: false,
        environmentKind: "local",
        environmentId: "environment_local",
        resource: null,
      },
    })
    expect(deps.findApprovedUserGrants).toHaveBeenCalledWith({
      appId: "app_changelog",
      environmentId: "environment_local",
      userId: "user_1",
    })
  })

  it("uses the exact resource for a dynamic client and ignores its metadata", async () => {
    const deps = dependencies({
      clientEnvironment: null,
      grants: [{ scopes: [{ scope: { key: "changelog:read" } }] }],
    })

    await expect(
      createChangelogOAuthGrantDecision(
        {
          ...authorizationInput,
          clientId: "dynamic_client",
          resources: ["http://localhost:3000/mcp"],
        },
        deps,
      ),
    ).resolves.toMatchObject({
      allowed: true,
      scopes: ["openid", "changelog:read"],
      target: {
        dynamicClient: true,
        environmentKind: "local",
        resource: "http://localhost:3000/mcp",
      },
    })
    expect(deps.findTargetEnvironment).toHaveBeenCalledWith("local")
  })

  it("denies a dynamic local client without an approved reader grant", async () => {
    const deps = dependencies({ clientEnvironment: null, grants: [] })

    await expect(
      createChangelogOAuthGrantDecision(
        {
          ...authorizationInput,
          clientId: "dynamic_client",
          requestedScopes: ["openid", "changelog:read"],
          resources: ["http://localhost:3000/mcp"],
        },
        deps,
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "changelog_access_denied",
    })
  })

  it("resolves native issuance from provider-owned resources without client metadata", async () => {
    const deps = dependencies({
      clientEnvironment: null,
      grants: [{ scopes: [{ scope: { key: "changelog:read" } }] }],
    })

    await expect(
      createChangelogOAuthGrantDecision(
        {
          ...authorizationInput,
          lifecycle: "exchange",
          clientId: undefined,
          resources: ["http://localhost:3000/mcp"],
          scopeCeiling: ["openid", "changelog:read"],
        },
        deps,
      ),
    ).resolves.toMatchObject({
      allowed: true,
      scopes: ["openid", "changelog:read"],
      target: {
        environmentKind: "local",
        resource: "http://localhost:3000/mcp",
      },
    })
    expect(deps.findClientEnvironment).not.toHaveBeenCalled()
  })

  it("rejects provider issuance without either a client or resource target", async () => {
    await expect(
      createChangelogOAuthGrantDecision(
        { ...authorizationInput, clientId: undefined },
        dependencies(),
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "invalid_changelog_target",
    })
  })

  it.each([
    {
      name: "missing user",
      input: { ...authorizationInput, userId: null },
      deps: dependencies(),
    },
    {
      name: "missing membership",
      input: { ...authorizationInput, membershipStatus: null },
      deps: dependencies(),
    },
    {
      name: "inactive membership",
      input: { ...authorizationInput, membershipStatus: "SUSPENDED" as const },
      deps: dependencies(),
    },
    {
      name: "malformed provider resources",
      input: {
        ...authorizationInput,
        resources: "http://localhost:3000/mcp" as unknown as string[],
      },
      deps: dependencies(),
    },
    {
      name: "unknown lifecycle",
      input: {
        ...authorizationInput,
        lifecycle: "client_credentials" as never,
        scopeCeiling: ["openid", "changelog:read"],
      },
      deps: dependencies({
        grants: [{ scopes: [{ scope: { key: "changelog:read" } }] }],
      }),
    },
    {
      name: "unknown seeded application",
      input: authorizationInput,
      deps: dependencies({
        clientEnvironment: {
          ...localEnvironment,
          app: { ...localEnvironment.app, key: "admin" },
        },
      }),
    },
    {
      name: "unapproved environment",
      input: authorizationInput,
      deps: dependencies({
        clientEnvironment: { ...localEnvironment, status: "PENDING" },
      }),
    },
    {
      name: "inactive application",
      input: authorizationInput,
      deps: dependencies({
        clientEnvironment: {
          ...localEnvironment,
          app: { ...localEnvironment.app, status: "SUSPENDED" },
        },
      }),
    },
  ])("fails closed for $name", async ({ input, deps }) => {
    await expect(
      createChangelogOAuthGrantDecision(input, deps),
    ).resolves.toEqual({ allowed: false, reason: "changelog_access_denied" })
  })

  it("fails closed on database errors without exposing their message", async () => {
    const deps = dependencies()
    deps.findApprovedUserGrants.mockRejectedValueOnce(
      new Error("postgres password and grant inventory"),
    )

    const decision = await createChangelogOAuthGrantDecision(
      authorizationInput,
      deps,
    )

    expect(decision).toEqual({
      allowed: false,
      reason: "changelog_access_denied",
    })
    expect(JSON.stringify(decision)).not.toContain("password")
    expect(JSON.stringify(decision)).not.toContain("grant inventory")
  })

  it("rejects stale exchange/refresh grants and later expansion cannot widen", async () => {
    const reader = dependencies({
      clientEnvironment: null,
      grants: [{ scopes: [{ scope: { key: "changelog:read" } }] }],
    })
    await expect(
      createChangelogOAuthGrantDecision(
        {
          ...authorizationInput,
          lifecycle: "exchange",
          clientId: "dynamic_client",
          resources: ["http://localhost:3000/mcp"],
          scopeCeiling: ["openid", "changelog:read", "changelog:submit"],
        },
        reader,
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "changelog_grant_changed",
    })

    const revoked = dependencies({ clientEnvironment: null, grants: [] })
    await expect(
      createChangelogOAuthGrantDecision(
        {
          ...authorizationInput,
          lifecycle: "refresh",
          clientId: "dynamic_client",
          resources: ["http://localhost:3000/mcp"],
          scopeCeiling: ["openid", "changelog:read"],
        },
        revoked,
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "changelog_grant_changed",
    })

    const administrator = dependencies({
      clientEnvironment: null,
      grants: [{ scopes: [{ scope: { key: "changelog:admin" } }] }],
    })
    await expect(
      createChangelogOAuthGrantDecision(
        {
          ...authorizationInput,
          lifecycle: "refresh",
          clientId: "dynamic_client",
          resources: ["http://localhost:3000/mcp"],
          scopeCeiling: ["openid", "changelog:read"],
        },
        administrator,
      ),
    ).resolves.toMatchObject({
      allowed: true,
      scopes: ["openid", "changelog:read"],
    })
  })
})
