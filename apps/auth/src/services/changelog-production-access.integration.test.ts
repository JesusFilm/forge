import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip
process.env.DATABASE_URL = databaseUrl ?? process.env.DATABASE_URL
process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED = "true"

describeIntegration("Changelog production operator access", () => {
  let prisma: typeof import("@/db/client").prisma
  let operate: typeof import("./changelog-production-access.service").operateChangelogProductionAccess
  let decide: typeof import("./changelog-oauth-grant.service").createChangelogOAuthGrantDecision
  const userId = `production_operator_it_${randomUUID()}`
  const email = `${userId}@example.test`

  beforeAll(async () => {
    ;({ prisma } = await import("@/db/client"))
    const { seedFirstPartyApps } =
      await import("@/scripts/seed-first-party-apps")
    await seedFirstPartyApps()
    ;({ operateChangelogProductionAccess: operate } =
      await import("./changelog-production-access.service"))
    ;({ createChangelogOAuthGrantDecision: decide } =
      await import("./changelog-oauth-grant.service"))
    await prisma.user.create({
      data: {
        id: userId,
        email,
        name: "Integration user",
        emailVerified: true,
        actorType: "HUMAN",
        membershipStatus: "ACTIVE",
      },
    })
  })

  beforeEach(async () => {
    const { hashAuditSubject } = await import("./audit.service")
    await prisma.authAuditEvent.deleteMany({
      where: { subjectHash: hashAuditSubject(userId) },
    })
    await prisma.appGrant.deleteMany({ where: { userId } })
    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        membershipStatus: "ACTIVE",
        actorType: "HUMAN",
      },
    })
  })

  afterAll(async () => {
    if (!prisma) return
    const { hashAuditSubject } = await import("./audit.service")
    await prisma.authAuditEvent.deleteMany({
      where: { subjectHash: hashAuditSubject(userId) },
    })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  const authorization = () =>
    decide({
      lifecycle: "authorization",
      userId,
      membershipStatus: "ACTIVE",
      clientId: "jfp_changelog_production",
      requestedScopes: [
        "openid",
        "changelog:read",
        "changelog:submit",
        "changelog:admin",
      ],
    })

  it("denies an ungranted user, then grants admin idempotently through the operator workflow", async () => {
    await expect(authorization()).resolves.toMatchObject({
      allowed: true,
      scopes: ["openid"],
    })
    const results = await Promise.all([
      operate("grant-admin", email),
      operate("grant-admin", email),
    ])
    expect(results.map((result) => result.changed).sort()).toEqual([
      false,
      true,
    ])
    await expect(authorization()).resolves.toMatchObject({
      allowed: true,
      scopes: [
        "openid",
        "changelog:read",
        "changelog:submit",
        "changelog:admin",
      ],
    })
    await expect(operate("inspect", email)).resolves.toMatchObject({
      userId,
      changed: false,
      membershipStatus: "ACTIVE",
      emailVerified: true,
      scopes: ["changelog:admin"],
    })
  })

  it("revokes the production grant union, blocks stale refresh and preserves local access", async () => {
    await operate("grant-admin", email)
    const { grantChangelogLocalReader } =
      await import("./changelog-local-reader-grant.service")
    await grantChangelogLocalReader(email)
    const environment = await prisma.appEnvironment.findUniqueOrThrow({
      where: { clientId: "jfp_changelog_production" },
    })
    const reader = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:read" },
    })
    for (const status of ["APPROVED", "PENDING"] as const) {
      await prisma.appGrant.create({
        data: {
          appId: environment.appId,
          environmentId: environment.id,
          subjectType: "USER",
          userId,
          status,
          scopes: { create: { scopeId: reader.id } },
        },
      })
    }
    await expect(operate("revoke", email)).resolves.toMatchObject({
      changed: true,
      scopes: [],
    })
    await expect(operate("revoke", email)).resolves.toMatchObject({
      changed: false,
      scopes: [],
    })
    await expect(authorization()).resolves.toMatchObject({
      allowed: true,
      scopes: ["openid"],
    })
    await expect(
      decide({
        lifecycle: "refresh",
        userId,
        membershipStatus: "ACTIVE",
        clientId: "jfp_changelog_production",
        requestedScopes: ["openid", "changelog:read", "changelog:admin"],
        scopeCeiling: ["openid", "changelog:read", "changelog:admin"],
      }),
    ).resolves.toMatchObject({ allowed: false })
    await expect(
      decide({
        lifecycle: "authorization",
        userId,
        membershipStatus: "ACTIVE",
        clientId: "jfp_changelog_local",
        requestedScopes: ["openid", "changelog:read", "changelog:admin"],
      }),
    ).resolves.toMatchObject({
      allowed: true,
      scopes: ["openid", "changelog:read"],
    })
    expect(
      await prisma.appGrant.count({
        where: { userId, environmentId: environment.id, revokedAt: null },
      }),
    ).toBe(0)
  })

  it.each([
    { emailVerified: false },
    { membershipStatus: "INVITED" as const },
    { membershipStatus: "SUSPENDED" as const },
    { membershipStatus: "DISABLED" as const },
    { actorType: "AGENT" as const },
  ])("refuses ineligible recipients: %j", async (data) => {
    await prisma.user.update({ where: { id: userId }, data })
    try {
      await expect(operate("grant-admin", email)).rejects.toThrow(
        "email-verified, active human",
      )
      await expect(operate("inspect", email)).resolves.toMatchObject({
        scopes: [],
      })
    } finally {
      await prisma.user.update({
        where: { id: userId },
        data: {
          emailVerified: true,
          membershipStatus: "ACTIVE",
          actorType: "HUMAN",
        },
      })
    }
  })

  it("allows revocation after membership is suspended and records auditable changes without email", async () => {
    await operate("grant-admin", email)
    await prisma.user.update({
      where: { id: userId },
      data: { membershipStatus: "SUSPENDED" },
    })
    await expect(operate("revoke", email)).resolves.toMatchObject({
      changed: true,
      scopes: [],
      membershipStatus: "SUSPENDED",
    })
    await prisma.user.update({
      where: { id: userId },
      data: { membershipStatus: "ACTIVE" },
    })
    const { hashAuditSubject } = await import("./audit.service")
    const audits = await prisma.authAuditEvent.findMany({
      where: {
        subjectHash: hashAuditSubject(userId),
        eventType: { startsWith: "changelog_production_" },
      },
    })
    expect(
      audits.filter(
        (audit) => audit.eventType === "changelog_production_admin_granted",
      ),
    ).toHaveLength(1)
    expect(
      audits.filter(
        (audit) => audit.eventType === "changelog_production_access_revoked",
      ),
    ).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain(email)
  })

  it("runs the real operator CLI for inspect, grant and revoke without exposing the recipient email", async () => {
    for (const operation of ["inspect", "grant-admin", "revoke"]) {
      const invocation = promisify(execFile)(
        "pnpm",
        ["--silent", "changelog:production-access", operation],
        {
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            NODE_ENV: "production",
          },
        },
      )
      invocation.child.stdin?.end(`${email}\n`)
      const { stdout, stderr } = await invocation
      expect(stdout).not.toContain(email)
      expect(stderr).not.toContain(email)
      expect(JSON.parse(stdout)).toMatchObject({
        userId,
        changed: operation !== "inspect",
      })
    }
    await expect(operate("inspect", email)).resolves.toMatchObject({
      scopes: [],
    })
  }, 15000)
})
