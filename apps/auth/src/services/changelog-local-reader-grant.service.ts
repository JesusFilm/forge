import { prisma } from "@/db/client"
import { CHANGELOG_APP_KEY, CHANGELOG_LOCAL_CLIENT_ID } from "@/domain/apps"
import { buildAuditEvent } from "./audit.service"

const CHANGELOG_READ_SCOPE = "changelog:read"
const READER_OR_HIGHER_SCOPES = new Set([
  CHANGELOG_READ_SCOPE,
  "changelog:submit",
  "changelog:admin",
])

export async function grantChangelogLocalReader(
  email: string,
): Promise<{ changed: boolean }> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email address.")
  }

  return prisma.$transaction(async (tx) => {
    const lockedEnvironments = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "app_environment"
      WHERE "client_id" = ${CHANGELOG_LOCAL_CLIENT_ID}
      FOR UPDATE
    `
    if (lockedEnvironments.length !== 1) {
      throw new Error("Local Changelog environment is not active and approved.")
    }

    const environment = await tx.appEnvironment.findUnique({
      where: { clientId: CHANGELOG_LOCAL_CLIENT_ID },
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
    if (
      !environment ||
      environment.key !== "local" ||
      environment.kind !== "LOCAL" ||
      environment.clientId !== CHANGELOG_LOCAL_CLIENT_ID ||
      environment.status !== "APPROVED" ||
      environment.app.key !== CHANGELOG_APP_KEY ||
      environment.app.status !== "ACTIVE"
    ) {
      throw new Error("Local Changelog environment is not active and approved.")
    }

    const user = await tx.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        emailVerified: true,
        actorType: true,
        membershipStatus: true,
      },
    })
    if (!user) throw new Error("Auth user was not found.")
    if (!user.emailVerified) throw new Error("Auth user email is not verified.")
    if (user.actorType !== "HUMAN") {
      throw new Error("Only human Auth users can receive this grant.")
    }
    if (user.membershipStatus !== "ACTIVE") {
      throw new Error("Auth user membership is not active.")
    }

    const scope = await tx.scope.findUnique({
      where: { key: CHANGELOG_READ_SCOPE },
      select: { id: true, key: true },
    })
    if (!scope || scope.key !== CHANGELOG_READ_SCOPE) {
      throw new Error("Changelog Reader scope is not registered.")
    }

    const grants = await tx.appGrant.findMany({
      where: {
        appId: environment.appId,
        environmentId: environment.id,
        subjectType: "USER",
        userId: user.id,
        status: "APPROVED",
        revokedAt: null,
      },
      select: {
        scopes: { select: { scope: { select: { key: true } } } },
      },
    })
    const alreadyReader = grants.some((grant) =>
      grant.scopes.some(({ scope: grantedScope }) =>
        READER_OR_HIGHER_SCOPES.has(grantedScope.key),
      ),
    )
    if (alreadyReader) return { changed: false }

    await tx.appGrant.create({
      data: {
        appId: environment.appId,
        environmentId: environment.id,
        subjectType: "USER",
        userId: user.id,
        status: "APPROVED",
        approvedAt: new Date(),
        reason: "Local Changelog Reader operator grant",
        scopes: { create: { scopeId: scope.id } },
      },
      select: { id: true },
    })
    await tx.authAuditEvent.create({
      data: buildAuditEvent({
        eventType: "changelog_local_reader_granted",
        appId: environment.appId,
        subject: user.id,
        metadata: {
          source: "grant_changelog_local_reader_command",
          environmentId: environment.id,
          scope: CHANGELOG_READ_SCOPE,
        },
      }),
    })

    return { changed: true }
  })
}
