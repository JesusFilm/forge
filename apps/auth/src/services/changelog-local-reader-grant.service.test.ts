import { beforeEach, describe, expect, it, vi } from "vitest"

import { grantChangelogLocalReader } from "./changelog-local-reader-grant.service"

const mocks = vi.hoisted(() => {
  const tx = {
    appEnvironment: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    scope: { findUnique: vi.fn() },
    appGrant: { findFirst: vi.fn(), create: vi.fn() },
    authAuditEvent: { create: vi.fn() },
    $queryRaw: vi.fn(),
  }
  return {
    tx,
    transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
  }
})

vi.mock("@/db/client", () => ({
  prisma: { $transaction: mocks.transaction },
}))

const environment = {
  id: "environment_local",
  appId: "app_changelog",
  key: "local",
  kind: "LOCAL",
  clientId: "jfp_changelog_local",
  status: "APPROVED",
  app: { id: "app_changelog", key: "changelog", status: "ACTIVE" },
}
const user = {
  id: "user_google",
  emailVerified: true,
  actorType: "HUMAN",
  membershipStatus: "ACTIVE",
}
const scope = { id: "scope_read", key: "changelog:read" }

describe("grantChangelogLocalReader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tx.appEnvironment.findUnique.mockResolvedValue(environment)
    mocks.tx.$queryRaw.mockResolvedValue([{ id: environment.id }])
    mocks.tx.user.findUnique.mockResolvedValue(user)
    mocks.tx.scope.findUnique.mockResolvedValue(scope)
    mocks.tx.appGrant.findFirst.mockResolvedValue(null)
    mocks.tx.appGrant.create.mockResolvedValue({ id: "grant_reader" })
    mocks.tx.authAuditEvent.create.mockResolvedValue({ id: "audit_grant" })
  })

  it("normalizes an eligible user's email and atomically creates the fixed Local Reader grant and audit", async () => {
    await expect(
      grantChangelogLocalReader("  Developer@Example.COM  "),
    ).resolves.toEqual({ changed: true })

    expect(mocks.tx.user.findUnique).toHaveBeenCalledWith({
      where: { email: "developer@example.com" },
      select: {
        id: true,
        emailVerified: true,
        actorType: true,
        membershipStatus: true,
      },
    })
    expect(mocks.tx.appEnvironment.findUnique).toHaveBeenCalledWith({
      where: { clientId: "jfp_changelog_local" },
      select: {
        id: true,
        appId: true,
        key: true,
        kind: true,
        clientId: true,
        status: true,
        app: { select: { id: true, key: true, status: true } },
      },
    })
    expect(mocks.tx.appGrant.create).toHaveBeenCalledWith({
      data: {
        appId: "app_changelog",
        environmentId: "environment_local",
        subjectType: "USER",
        userId: "user_google",
        status: "APPROVED",
        approvedAt: expect.any(Date),
        reason: "Local Changelog Reader operator grant",
        scopes: { create: { scopeId: "scope_read" } },
      },
      select: { id: true },
    })
    expect(mocks.tx.authAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "changelog_local_reader_granted",
        actorUserId: null,
        appId: "app_changelog",
        subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        metadata: {
          source: "grant_changelog_local_reader_command",
          environmentId: "environment_local",
          scope: "changelog:read",
        },
      }),
    })
    expect(
      JSON.stringify(mocks.tx.authAuditEvent.create.mock.calls),
    ).not.toContain("developer@example.com")
  })

  it("returns no change when an approved Local Reader-or-higher grant exists", async () => {
    mocks.tx.appGrant.findFirst.mockResolvedValue({ id: "grant_existing" })

    await expect(
      grantChangelogLocalReader("developer@example.com"),
    ).resolves.toEqual({ changed: false })
    expect(mocks.tx.appGrant.create).not.toHaveBeenCalled()
    expect(mocks.tx.authAuditEvent.create).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", null, "Auth user was not found."],
    ["unverified", { ...user, emailVerified: false }, "not verified"],
    ["agent", { ...user, actorType: "AGENT" }, "human"],
    ["invited", { ...user, membershipStatus: "INVITED" }, "not active"],
    ["suspended", { ...user, membershipStatus: "SUSPENDED" }, "not active"],
    ["disabled", { ...user, membershipStatus: "DISABLED" }, "not active"],
  ])("rejects an %s identity without writes", async (_name, found, message) => {
    mocks.tx.user.findUnique.mockResolvedValue(found)

    await expect(
      grantChangelogLocalReader("developer@example.com"),
    ).rejects.toThrow(message as string)
    expect(mocks.tx.appGrant.create).not.toHaveBeenCalled()
    expect(mocks.tx.authAuditEvent.create).not.toHaveBeenCalled()
  })

  it.each([
    ["missing environment", null],
    ["wrong key", { ...environment, key: "preview" }],
    ["wrong kind", { ...environment, kind: "PRODUCTION" }],
    ["unapproved", { ...environment, status: "PENDING" }],
    [
      "wrong app",
      { ...environment, app: { ...environment.app, key: "admin" } },
    ],
    [
      "inactive app",
      { ...environment, app: { ...environment.app, status: "SUSPENDED" } },
    ],
  ])("fails closed for a %s", async (_name, found) => {
    mocks.tx.appEnvironment.findUnique.mockResolvedValue(found)

    await expect(
      grantChangelogLocalReader("developer@example.com"),
    ).rejects.toThrow("Local Changelog environment is not active and approved.")
    expect(mocks.tx.appGrant.create).not.toHaveBeenCalled()
    expect(mocks.tx.authAuditEvent.create).not.toHaveBeenCalled()
  })

  it("fails closed when the canonical read scope is missing", async () => {
    mocks.tx.scope.findUnique.mockResolvedValue(null)

    await expect(
      grantChangelogLocalReader("developer@example.com"),
    ).rejects.toThrow("Changelog Reader scope is not registered.")
    expect(mocks.tx.appGrant.create).not.toHaveBeenCalled()
    expect(mocks.tx.authAuditEvent.create).not.toHaveBeenCalled()
  })

  it("locks the Local environment before reading effective grants", async () => {
    await grantChangelogLocalReader("developer@example.com")

    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce()
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tx.appGrant.findFirst.mock.invocationCallOrder[0]!,
    )
    expect(mocks.tx.appGrant.findFirst).toHaveBeenCalledWith({
      where: {
        appId: "app_changelog",
        environmentId: "environment_local",
        subjectType: "USER",
        userId: "user_google",
        status: "APPROVED",
        revokedAt: null,
        scopes: {
          some: {
            scope: {
              key: {
                in: ["changelog:read", "changelog:submit", "changelog:admin"],
              },
            },
          },
        },
      },
      select: { id: true },
    })
  })

  it("rejects malformed email before starting a transaction", async () => {
    await expect(grantChangelogLocalReader("not-an-email")).rejects.toThrow(
      "Enter a valid email address.",
    )
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
