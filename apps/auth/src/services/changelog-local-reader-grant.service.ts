import { prisma } from "@/db/client"
import { CHANGELOG_APP_KEY, CHANGELOG_LOCAL_CLIENT_ID } from "@/domain/apps"
import { CHANGELOG_OAUTH_SCOPES } from "@/domain/scopes"
import { buildAuditEvent } from "./audit.service"

const CHANGELOG_READ_SCOPE = "changelog:read"

export type ChangelogLocalReaderGrantErrorCode =
  | "email_invalid"
  | "environment_unavailable"
  | "scope_unavailable"
  | "user_email_unverified"
  | "user_inactive"
  | "user_not_found"
  | "user_not_human"

export class ChangelogLocalReaderGrantError extends Error {
  constructor(
    public readonly code: ChangelogLocalReaderGrantErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "ChangelogLocalReaderGrantError"
  }
}

export async function grantChangelogLocalReader(
  email: string,
): Promise<{ changed: boolean }> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new ChangelogLocalReaderGrantError(
      "email_invalid",
      "Enter a valid email address.",
    )
  }

  return prisma.$transaction(async (tx) => {
    const lockedEnvironments = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "app_environment"
      WHERE "client_id" = ${CHANGELOG_LOCAL_CLIENT_ID}
      FOR UPDATE
    `
    if (lockedEnvironments.length !== 1) {
      throw new ChangelogLocalReaderGrantError(
        "environment_unavailable",
        "Local Changelog environment is not active and approved.",
      )
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
      throw new ChangelogLocalReaderGrantError(
        "environment_unavailable",
        "Local Changelog environment is not active and approved.",
      )
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
    if (!user) {
      throw new ChangelogLocalReaderGrantError(
        "user_not_found",
        "Auth user was not found.",
      )
    }
    if (!user.emailVerified) {
      throw new ChangelogLocalReaderGrantError(
        "user_email_unverified",
        "Auth user email is not verified.",
      )
    }
    if (user.actorType !== "HUMAN") {
      throw new ChangelogLocalReaderGrantError(
        "user_not_human",
        "Only human Auth users can receive this grant.",
      )
    }
    if (user.membershipStatus !== "ACTIVE") {
      throw new ChangelogLocalReaderGrantError(
        "user_inactive",
        "Auth user membership is not active.",
      )
    }

    const scope = await tx.scope.findUnique({
      where: { key: CHANGELOG_READ_SCOPE },
      select: { id: true, key: true },
    })
    if (!scope || scope.key !== CHANGELOG_READ_SCOPE) {
      throw new ChangelogLocalReaderGrantError(
        "scope_unavailable",
        "Changelog Reader scope is not registered.",
      )
    }

    const existingGrant = await tx.appGrant.findFirst({
      where: {
        appId: environment.appId,
        environmentId: environment.id,
        subjectType: "USER",
        userId: user.id,
        status: "APPROVED",
        revokedAt: null,
        scopes: {
          some: { scope: { key: { in: [...CHANGELOG_OAUTH_SCOPES] } } },
        },
      },
      select: { id: true },
    })
    if (existingGrant) return { changed: false }

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
