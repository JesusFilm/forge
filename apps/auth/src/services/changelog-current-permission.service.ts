import { createLocalJWKSet, errors, jwtVerify } from "jose"

import { getAuthBaseUrl, isChangelogProductionEnabled } from "@/config/env"
import { prisma } from "@/db/client"
import {
  CHANGELOG_APP_KEY,
  CHANGELOG_LOCAL_CLIENT_ID,
  CHANGELOG_PRODUCTION_CLIENT_ID,
} from "@/domain/apps"
import { CHANGELOG_OAUTH_RESOURCES } from "@/domain/changelog-oauth-resources"

const scopes = [
  "changelog:read",
  "changelog:submit",
  "changelog:admin",
] as const

export class CurrentPermissionError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? "invalid-credential" : "access-denied")
  }
}

/** A fresh, non-cacheable authorization decision for one Changelog environment. */
export async function currentChangelogPermission(
  authorization: string | null,
  clientId: string,
) {
  const kind =
    clientId === CHANGELOG_LOCAL_CLIENT_ID
      ? "LOCAL"
      : clientId === CHANGELOG_PRODUCTION_CLIENT_ID
        ? "PRODUCTION"
        : null
  if (!kind) throw new CurrentPermissionError(403)
  const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1]
  if (!token || token.length > 16384) throw new CurrentPermissionError(401)
  const target = kind === "LOCAL" ? "local" : "production"

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`
      const keys = await tx.jwks.findMany({
        select: { id: true, publicKey: true, alg: true },
      })
      const keySet = createLocalJWKSet({
        keys: keys.map((key) => ({
          ...JSON.parse(key.publicKey),
          kid: key.id,
          alg: key.alg ?? "EdDSA",
        })),
      })
      let verified: Awaited<ReturnType<typeof jwtVerify>>
      try {
        verified = await jwtVerify(token, keySet, {
          issuer: `${getAuthBaseUrl()}/api/auth`,
          audience: CHANGELOG_OAUTH_RESOURCES[target],
          algorithms: ["EdDSA"],
          typ: "at+jwt",
          requiredClaims: ["exp", "iat", "sub", "sid"],
        })
      } catch (error) {
        if (
          !(error instanceof errors.JOSEError) ||
          error instanceof errors.JWKInvalid ||
          error instanceof errors.JWKSInvalid ||
          error instanceof errors.JWKSMultipleMatchingKeys
        )
          throw error
        throw new CurrentPermissionError(401)
      }
      const { payload } = verified
      if (
        typeof payload.sub !== "string" ||
        typeof payload.sid !== "string" ||
        typeof payload.client_id !== "string" ||
        payload.azp !== payload.client_id ||
        payload.cnf ||
        payload["https://jesusfilm.org/claims/app"] !== CHANGELOG_APP_KEY ||
        payload["https://jesusfilm.org/claims/environment"] !== target ||
        typeof payload.scope !== "string"
      )
        throw new CurrentPermissionError(401)
      const subject = payload.sub
      const sessionId = payload.sid
      const issuedScopes = new Set(payload.scope.split(" "))
      const client = await tx.oauthClient.findUnique({
        where: { clientId: payload.client_id },
        select: { disabled: true },
      })
      if (!client || client.disabled) throw new CurrentPermissionError(401)
      // A seeded website credential is tied to its own environment. Dynamic
      // MCP credentials use the signed resource and environment claims.
      if (
        (payload.client_id === CHANGELOG_LOCAL_CLIENT_ID ||
          payload.client_id === CHANGELOG_PRODUCTION_CLIENT_ID) &&
        payload.client_id !== clientId
      )
        throw new CurrentPermissionError(401)

      // Grant writers lock this row. A reduction that already committed is
      // visible; one that commits later waits until this decision completes.
      await tx.$queryRaw`SELECT id FROM app_environment WHERE client_id = ${clientId} FOR SHARE`
      const [session, environment] = await Promise.all([
        tx.session.findUnique({
          where: { id: sessionId },
          include: { user: true },
        }),
        tx.appEnvironment.findUnique({
          where: { clientId },
          include: { app: true },
        }),
      ])
      const now = new Date()
      if (
        !session ||
        session.userId !== subject ||
        session.expiresAt <= now ||
        session.user.membershipStatus !== "ACTIVE" ||
        session.user.actorType !== "HUMAN" ||
        (session.user.expiresAt && session.user.expiresAt <= now) ||
        !environment ||
        environment.kind !== kind ||
        environment.status !== "APPROVED" ||
        environment.app.key !== CHANGELOG_APP_KEY ||
        environment.app.status !== "ACTIVE" ||
        (kind === "PRODUCTION" && !isChangelogProductionEnabled())
      )
        throw new CurrentPermissionError(403)

      const grants = await tx.appGrant.findMany({
        where: {
          appId: environment.appId,
          environmentId: environment.id,
          subjectType: "USER",
          userId: subject,
          status: "APPROVED",
          revokedAt: null,
        },
        select: { scopes: { select: { scope: { select: { key: true } } } } },
      })
      const current = new Set(
        grants.flatMap((grant) => grant.scopes.map(({ scope }) => scope.key)),
      )
      if (current.has("changelog:admin")) {
        current.add("changelog:submit")
        current.add("changelog:read")
      } else if (current.has("changelog:submit")) {
        current.add("changelog:read")
      }
      return {
        subject,
        clientId,
        environment: target,
        scopes: scopes.filter(
          (scope) => current.has(scope) && issuedScopes.has(scope),
        ),
      }
    },
    { isolationLevel: "ReadCommitted", maxWait: 1000, timeout: 6000 },
  )
}
