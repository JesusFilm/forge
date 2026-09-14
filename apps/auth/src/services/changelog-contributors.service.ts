import type { Prisma } from "@/generated/prisma"
import { createLocalJWKSet, jwtVerify } from "jose"

import { getAuthBaseUrl, isChangelogProductionEnabled } from "@/config/env"
import { prisma } from "@/db/client"
import { buildAuditEvent } from "./audit.service"
import { CHANGELOG_OAUTH_RESOURCES } from "@/domain/changelog-oauth-resources"
import {
  CHANGELOG_APP_KEY,
  CHANGELOG_LOCAL_CLIENT_ID,
  CHANGELOG_PRODUCTION_CLIENT_ID,
} from "@/domain/apps"

export class ContributorManagementError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code)
  }
}

export async function manageChangelogContributors(
  bearer: string | null,
  clientId: string,
  recipientId?: string,
) {
  return withChangelogAdmin(
    bearer,
    clientId,
    async ({ tx, environment, actorId, kind, grants }) => {
      const contributors = new Map<
        string,
        { id: string; name: string; email: string; canRevoke: boolean }
      >()
      for (const grant of grants) {
        if (!grant.user) continue
        const admin = grant.scopes.some(
          ({ scope }) => scope.key === "changelog:admin",
        )
        if (
          !admin &&
          !grant.scopes.some(({ scope }) => scope.key === "changelog:submit")
        )
          continue
        const previous = contributors.get(grant.user.id)
        contributors.set(grant.user.id, {
          id: grant.user.id,
          name: grant.user.name,
          email: grant.user.email,
          canRevoke: !admin && previous?.canRevoke !== false,
        })
      }
      if (recipientId !== undefined) {
        const recipient = contributors.get(recipientId)
        if (recipient && !recipient.canRevoke)
          throw new ContributorManagementError(409, "admin-recipient")
        const changed = await tx.appGrantScope.deleteMany({
          where: {
            scope: { key: "changelog:submit" },
            grant: {
              appId: environment.appId,
              environmentId: environment.id,
              subjectType: "USER",
              userId: recipientId,
              status: "APPROVED",
              revokedAt: null,
            },
          },
        })
        if (changed.count)
          await tx.authAuditEvent.create({
            data: buildAuditEvent({
              eventType: "changelog_contributor_revoked",
              appId: environment.appId,
              subject: recipientId,
              metadata: {
                actorId,
                environmentId: environment.id,
                scope: "changelog:submit",
              },
            }),
          })
        return { changed: changed.count > 0 }
      }
      return {
        environment: kind.toLowerCase(),
        contributors: [...contributors.values()].sort((a, b) =>
          a.email.localeCompare(b.email),
        ),
      }
    },
  )
}

export async function withChangelogAdmin<T>(
  bearer: string | null,
  clientId: string,
  operation: (context: {
    tx: Prisma.TransactionClient
    environment: { id: string; appId: string }
    actorId: string
    kind: string
    grants: Prisma.AppGrantGetPayload<{
      include: { scopes: { include: { scope: true } }; user: true }
    }>[]
  }) => Promise<T>,
): Promise<T> {
  if (
    ![CHANGELOG_LOCAL_CLIENT_ID, CHANGELOG_PRODUCTION_CLIENT_ID].includes(
      clientId,
    )
  ) {
    throw new ContributorManagementError(403, "access-denied")
  }
  if (!bearer?.startsWith("Bearer ") || bearer.length > 16384) {
    throw new ContributorManagementError(401, "sign-in-required")
  }
  const kind = clientId === CHANGELOG_LOCAL_CLIENT_ID ? "LOCAL" : "PRODUCTION"
  const target = kind === "LOCAL" ? "local" : "production"
  return prisma.$transaction(
    async (tx) => {
      // Bound queued work and PostgreSQL statements below Changelog's 10s budget.
      await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`
      const keys = await tx.jwks.findMany({
        select: { id: true, publicKey: true, alg: true },
      })
      let actorId: string
      let sessionId: string
      try {
        const { payload } = await jwtVerify(
          bearer.slice(7),
          createLocalJWKSet({
            keys: keys.map((key) => ({
              ...JSON.parse(key.publicKey),
              kid: key.id,
              alg: key.alg ?? "EdDSA",
            })),
          }),
          {
            issuer: `${getAuthBaseUrl()}/api/auth`,
            audience: CHANGELOG_OAUTH_RESOURCES[target],
            algorithms: ["EdDSA"],
            typ: "at+jwt",
            requiredClaims: ["exp", "iat", "sub", "sid"],
          },
        )
        if (
          payload.azp !== clientId ||
          payload.client_id !== clientId ||
          payload.cnf ||
          payload["https://jesusfilm.org/claims/app"] !== "changelog" ||
          payload["https://jesusfilm.org/claims/environment"] !== target ||
          typeof payload.scope !== "string" ||
          !payload.scope.split(" ").includes("changelog:admin") ||
          typeof payload.sub !== "string" ||
          typeof payload.sid !== "string"
        )
          throw new ContributorManagementError(403, "access-denied")
        actorId = payload.sub
        sessionId = payload.sid
      } catch {
        throw new ContributorManagementError(403, "access-denied")
      }
      // Production grant writers also update this row. A writer that committed
      // after our snapshot forces a serialization failure here (503), so a
      // retry rechecks current authority and Admin-recipient protection.
      await tx.$queryRaw`SELECT id FROM app_environment WHERE client_id = ${clientId} FOR UPDATE`
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      })
      const client = await tx.oauthClient.findUnique({ where: { clientId } })
      if (
        !client ||
        client.disabled ||
        !session ||
        session.userId !== actorId ||
        session.expiresAt <= new Date() ||
        session.user.membershipStatus !== "ACTIVE" ||
        session.user.actorType !== "HUMAN"
      ) {
        throw new ContributorManagementError(403, "access-denied")
      }
      const environment = await tx.appEnvironment.findUnique({
        where: { clientId },
        include: { app: true },
      })
      if (
        !environment ||
        environment.kind !== kind ||
        environment.status !== "APPROVED" ||
        environment.app.key !== CHANGELOG_APP_KEY ||
        environment.app.status !== "ACTIVE" ||
        (kind === "PRODUCTION" && !isChangelogProductionEnabled())
      ) {
        throw new ContributorManagementError(403, "access-denied")
      }
      const grants = await tx.appGrant.findMany({
        where: {
          appId: environment.appId,
          environmentId: environment.id,
          subjectType: "USER",
          status: "APPROVED",
          revokedAt: null,
        },
        include: { scopes: { include: { scope: true } }, user: true },
      })
      if (
        !grants.some(
          (grant) =>
            grant.userId === actorId &&
            grant.scopes.some(({ scope }) => scope.key === "changelog:admin"),
        )
      ) {
        throw new ContributorManagementError(403, "access-denied")
      }
      return operation({ tx, environment, actorId, kind, grants })
    },
    { isolationLevel: "Serializable", maxWait: 1000, timeout: 6000 },
  )
}
