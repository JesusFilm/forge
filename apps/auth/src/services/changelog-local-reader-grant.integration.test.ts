import { createHash, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Opt-in PostgreSQL proof for the transaction and row lock.
 *
 *   AUTH_TEST_DATABASE_URL=postgresql://forge:forge@localhost:5432/auth_it \
 *     pnpm --filter @forge/auth test -- changelog-local-reader-grant.integration
 */
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip

process.env.DATABASE_URL = databaseUrl ?? process.env.DATABASE_URL

describeIntegration("Changelog Local Reader grant transaction", () => {
  let prisma: typeof import("@/db/client").prisma
  let grantReader: typeof import("./changelog-local-reader-grant.service").grantChangelogLocalReader
  const userId = `changelog_reader_it_${randomUUID()}`
  const email = `changelog_reader_it_${randomUUID()}@example.test`
  let appId = ""
  let localEnvironmentId = ""
  let productionEnvironmentId = ""

  beforeAll(async () => {
    ;({ prisma } = await import("@/db/client"))
    const { seedFirstPartyApps } =
      await import("@/scripts/seed-first-party-apps")
    await seedFirstPartyApps()
    ;({ grantChangelogLocalReader: grantReader } =
      await import("./changelog-local-reader-grant.service"))

    const app = await prisma.registeredApp.findUniqueOrThrow({
      where: { key: "changelog" },
      select: {
        id: true,
        environments: {
          where: { kind: { in: ["LOCAL", "PRODUCTION"] } },
          select: { id: true, kind: true },
        },
      },
    })
    appId = app.id
    localEnvironmentId = app.environments.find(
      ({ kind }) => kind === "LOCAL",
    )!.id
    productionEnvironmentId = app.environments.find(
      ({ kind }) => kind === "PRODUCTION",
    )!.id
    const readScope = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:read" },
      select: { id: true },
    })
    const adminScope = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:admin" },
      select: { id: true },
    })

    await prisma.user.create({
      data: {
        id: userId,
        name: "Changelog Reader Integration User",
        email,
        emailVerified: true,
        actorType: "HUMAN",
        membershipStatus: "ACTIVE",
      },
    })
    await prisma.appGrant.create({
      data: {
        appId,
        environmentId: localEnvironmentId,
        subjectType: "USER",
        userId,
        status: "REVOKED",
        approvedAt: new Date(),
        revokedAt: new Date(),
        reason: "Historical revoked Reader grant",
        scopes: { create: { scopeId: readScope.id } },
      },
    })
    await prisma.appGrant.create({
      data: {
        appId,
        environmentId: productionEnvironmentId,
        subjectType: "USER",
        userId,
        status: "APPROVED",
        approvedAt: new Date(),
        reason: "Production isolation sentinel",
        scopes: { create: { scopeId: adminScope.id } },
      },
    })
  })

  afterAll(async () => {
    if (!databaseUrl || !prisma) return
    const subjectHash = createHash("sha256").update(userId).digest("hex")
    await prisma.authAuditEvent.deleteMany({
      where: {
        eventType: "changelog_local_reader_granted",
        appId,
        subjectHash,
      },
    })
    await prisma.appGrant.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("serializes concurrent calls to one Local Reader grant and audit without touching history or Production", async () => {
    const productionBefore = await prisma.appGrant.findFirstOrThrow({
      where: { userId, environmentId: productionEnvironmentId },
      include: { scopes: true },
    })

    const results = await Promise.all([grantReader(email), grantReader(email)])
    expect(results.map(({ changed }) => changed).sort()).toEqual([false, true])

    const localGrants = await prisma.appGrant.findMany({
      where: { userId, environmentId: localEnvironmentId },
      include: { scopes: { include: { scope: true } } },
      orderBy: { createdAt: "asc" },
    })
    expect(localGrants).toHaveLength(2)
    expect(localGrants[0]).toMatchObject({
      status: "REVOKED",
      reason: "Historical revoked Reader grant",
    })
    expect(localGrants[1]).toMatchObject({
      status: "APPROVED",
      revokedAt: null,
      scopes: [{ scope: { key: "changelog:read" } }],
    })

    const subjectHash = createHash("sha256").update(userId).digest("hex")
    const audits = await prisma.authAuditEvent.findMany({
      where: {
        eventType: "changelog_local_reader_granted",
        appId,
        subjectHash,
      },
    })
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0]?.metadata)).not.toContain(email)

    await expect(grantReader(email.toUpperCase())).resolves.toEqual({
      changed: false,
    })
    await expect(
      prisma.authAuditEvent.count({
        where: {
          eventType: "changelog_local_reader_granted",
          appId,
          subjectHash,
        },
      }),
    ).resolves.toBe(1)
    await expect(
      prisma.appGrant.findFirstOrThrow({
        where: { id: productionBefore.id },
        include: { scopes: true },
      }),
    ).resolves.toEqual(productionBefore)
  })
})
