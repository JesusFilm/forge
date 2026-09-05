import { prisma } from "@/db/client"
import {
  CHANGELOG_APP_KEY,
  CHANGELOG_PRODUCTION_CLIENT_ID,
} from "@/domain/apps"
import { buildAuditEvent } from "./audit.service"

export type ChangelogProductionOperation = "inspect" | "grant-admin" | "revoke"

export class ChangelogProductionAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ChangelogProductionAccessError"
  }
}

export async function operateChangelogProductionAccess(
  operation: ChangelogProductionOperation,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new ChangelogProductionAccessError("Enter a valid recipient email.")
  }
  if (
    operation !== "inspect" &&
    operation !== "grant-admin" &&
    operation !== "revoke"
  ) {
    throw new ChangelogProductionAccessError(
      "Unknown production access operation.",
    )
  }

  return prisma.$transaction(async (tx) => {
    // The same environment lock serializes every production grant mutation.
    await tx.$queryRaw`
      SELECT id FROM app_environment
      WHERE client_id = ${CHANGELOG_PRODUCTION_CLIENT_ID} FOR UPDATE
    `
    const environment = await tx.appEnvironment.findUnique({
      where: { clientId: CHANGELOG_PRODUCTION_CLIENT_ID },
      include: { app: true },
    })
    if (
      !environment ||
      environment.key !== "production" ||
      environment.kind !== "PRODUCTION" ||
      environment.app.key !== CHANGELOG_APP_KEY
    ) {
      throw new ChangelogProductionAccessError(
        "Production Changelog environment is unavailable.",
      )
    }
    const users = await tx.user.findMany({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: {
        id: true,
        emailVerified: true,
        membershipStatus: true,
        actorType: true,
      },
      take: 2,
    })
    if (users.length !== 1) {
      throw new ChangelogProductionAccessError(
        "Recipient must match exactly one existing Auth user.",
      )
    }
    const user = users[0]
    const where = {
      appId: environment.appId,
      environmentId: environment.id,
      subjectType: "USER" as const,
      userId: user.id,
    }
    let changed = false
    const current = await tx.appGrant.findMany({
      where: { ...where, status: "APPROVED", revokedAt: null },
      include: { scopes: { include: { scope: true } } },
    })
    const scopes = [
      ...new Set(
        current.flatMap((grant) => grant.scopes.map((item) => item.scope.key)),
      ),
    ].sort()

    if (operation === "grant-admin") {
      if (
        environment.status !== "APPROVED" ||
        environment.app.status !== "ACTIVE"
      ) {
        throw new ChangelogProductionAccessError(
          "Production Changelog must be active and approved.",
        )
      }
      if (
        !user.emailVerified ||
        user.membershipStatus !== "ACTIVE" ||
        user.actorType !== "HUMAN"
      ) {
        throw new ChangelogProductionAccessError(
          "Recipient must be an email-verified, active human.",
        )
      }
      if (!scopes.includes("changelog:admin")) {
        const scope = await tx.scope.findUnique({
          where: { key: "changelog:admin" },
        })
        if (!scope)
          throw new ChangelogProductionAccessError(
            "Changelog Admin scope is not registered.",
          )
        await tx.appGrant.create({
          data: {
            ...where,
            status: "APPROVED",
            approvedAt: new Date(),
            reason: "Production Changelog Admin operator grant",
            scopes: { create: { scopeId: scope.id } },
          },
        })
        await tx.authAuditEvent.create({
          data: buildAuditEvent({
            eventType: "changelog_production_admin_granted",
            appId: environment.appId,
            subject: user.id,
            metadata: {
              source: "changelog_production_access_command",
              environmentId: environment.id,
              scope: "changelog:admin",
            },
          }),
        })
        scopes.push("changelog:admin")
        scopes.sort()
        changed = true
      }
    }
    if (operation === "revoke") {
      const result = await tx.appGrant.updateMany({
        where: { ...where, status: { not: "REVOKED" } },
        data: { status: "REVOKED", revokedAt: new Date() },
      })
      changed = result.count > 0
      if (changed) {
        await tx.authAuditEvent.create({
          data: buildAuditEvent({
            eventType: "changelog_production_access_revoked",
            appId: environment.appId,
            subject: user.id,
            metadata: {
              source: "changelog_production_access_command",
              environmentId: environment.id,
              grantsRevoked: result.count,
            },
          }),
        })
      }
      scopes.length = 0
    }
    return {
      changed,
      userId: user.id,
      membershipStatus: user.membershipStatus,
      emailVerified: user.emailVerified,
      actorType: user.actorType,
      environmentId: environment.id,
      environmentStatus: environment.status,
      appStatus: environment.app.status,
      scopes,
    }
  })
}
