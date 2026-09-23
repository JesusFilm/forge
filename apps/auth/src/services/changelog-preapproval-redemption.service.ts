import { Prisma } from "@/generated/prisma"
import { prisma } from "@/db/client"
import { isChangelogProductionEnabled } from "@/config/env"
import { CHANGELOG_OAUTH_RESOURCES } from "@/domain/changelog-oauth-resources"
import { CHANGELOG_APP_KEY } from "@/domain/apps"
import { buildAuditEvent } from "./audit.service"

export type PreapprovalRedemptionInput = {
  userId: string
  sessionId: string
  environmentId: string
  clientId: string
  redirectUri: string
}

/** A serialization conflict denies this attempt; only a fresh authorization retries. */
export async function redeemChangelogPreapprovals(
  input: PreapprovalRedemptionInput,
) {
  const candidate = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: { userId: true, googleEmail: true, googleSubject: true },
  })
  if (
    candidate?.userId !== input.userId ||
    !candidate.googleEmail ||
    !candidate.googleSubject
  )
    return
  const pending = await prisma.changelogPreapproval.findFirst({
    where: {
      environmentId: input.environmentId,
      email: candidate.googleEmail,
      state: "pending",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  })
  if (!pending) return
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`
      // Management and authority writers share this lock. Updating (not just
      // locking) invalidates a concurrent redemption's Serializable snapshot.
      await tx.$executeRaw`UPDATE app_environment SET updated_at = clock_timestamp() WHERE id = ${input.environmentId}`
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId} FOR UPDATE`
      const now = new Date()
      const environment = await tx.appEnvironment.findUnique({
        where: { id: input.environmentId },
        include: { app: true },
      })
      if (
        !environment ||
        environment.app.key !== CHANGELOG_APP_KEY ||
        environment.app.status !== "ACTIVE" ||
        environment.status !== "APPROVED" ||
        !["LOCAL", "PRODUCTION"].includes(environment.kind) ||
        (environment.kind === "PRODUCTION" && !isChangelogProductionEnabled())
      )
        return
      const client = await tx.oauthClient.findUnique({
        where: { clientId: input.clientId },
      })
      if (
        !client ||
        client.disabled ||
        !client.redirectUris.includes(input.redirectUri)
      )
        return
      const clientEnvironment = await tx.appEnvironment.findUnique({
        where: { clientId: input.clientId },
        select: { id: true },
      })
      if (clientEnvironment && clientEnvironment.id !== environment.id) return
      const resource =
        CHANGELOG_OAUTH_RESOURCES[
          environment.kind === "LOCAL" ? "local" : "production"
        ]
      if (
        !(await tx.oauthClientResource.findFirst({
          where: {
            clientId: input.clientId,
            resourceId: resource,
            resource: { disabled: false },
          },
        }))
      )
        return
      await tx.$queryRaw`SELECT id FROM session WHERE id = ${input.sessionId} FOR UPDATE`
      const session = await tx.session.findUnique({
        where: { id: input.sessionId },
        include: { user: true },
      })
      if (
        !session ||
        session.userId !== input.userId ||
        session.expiresAt <= now ||
        !session.googleEmail ||
        !session.googleSubject ||
        !["ACTIVE", "INVITED"].includes(session.user.membershipStatus) ||
        session.user.actorType !== "HUMAN" ||
        !session.user.emailVerified ||
        (session.user.expiresAt && session.user.expiresAt <= now) ||
        session.user.email.trim().toLowerCase() !== session.googleEmail
      )
        return
      const account = await tx.account.findFirst({
        where: {
          userId: input.userId,
          providerId: "google",
          issuer: "https://accounts.google.com",
          accountId: session.googleSubject,
        },
      })
      if (!account) return
      await tx.$queryRaw`SELECT id FROM account WHERE id = ${account.id} FOR SHARE`
      const pending = await tx.changelogPreapproval.findMany({
        where: {
          environmentId: environment.id,
          email: session.googleEmail,
          state: "pending",
          expiresAt: { gt: now },
        },
      })
      if (!pending.length) return
      // expiresAt changes do not touch the environment authority trigger.
      // Lock approver identities too so their eligibility cannot use an old snapshot.
      const approverIds = [
        ...new Set(pending.map(({ approverId }) => approverId)),
      ].sort()
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "user" WHERE id IN (${Prisma.join(approverIds)}) ORDER BY id FOR UPDATE`,
      )
      const redeemedAt = new Date()
      if (
        session.expiresAt <= redeemedAt ||
        (session.user.expiresAt && session.user.expiresAt <= redeemedAt)
      )
        return
      const admins = await tx.appGrant.findMany({
        where: {
          appId: environment.appId,
          environmentId: environment.id,
          subjectType: "USER",
          status: "APPROVED",
          revokedAt: null,
          userId: { in: pending.map((approval) => approval.approverId) },
          user: {
            membershipStatus: "ACTIVE",
            actorType: "HUMAN",
            OR: [{ expiresAt: null }, { expiresAt: { gt: redeemedAt } }],
          },
          scopes: { some: { scope: { key: "changelog:admin" } } },
        },
        select: { userId: true },
      })
      const eligible = pending.filter(
        (approval) =>
          approval.expiresAt > redeemedAt &&
          admins.some((admin) => admin.userId === approval.approverId),
      )
      if (!eligible.length) return
      // Activation belongs to redemption: any later persistence failure rolls
      // back membership, the Contributor grant and the consumed approvals.
      if (session.user.membershipStatus === "INVITED") {
        await tx.user.update({
          where: { id: input.userId },
          data: { membershipStatus: "ACTIVE" },
        })
      }
      const existing = await tx.appGrant.findFirst({
        where: {
          appId: environment.appId,
          environmentId: environment.id,
          subjectType: "USER",
          userId: input.userId,
          status: "APPROVED",
          revokedAt: null,
          scopes: {
            some: {
              scope: { key: { in: ["changelog:submit", "changelog:admin"] } },
            },
          },
        },
      })
      if (!existing) {
        const scope = await tx.scope.findUniqueOrThrow({
          where: { key: "changelog:submit" },
        })
        await tx.appGrant.create({
          data: {
            appId: environment.appId,
            environmentId: environment.id,
            subjectType: "USER",
            userId: input.userId,
            status: "APPROVED",
            approvedAt: redeemedAt,
            reason: "Individual Contributor preapproval",
            scopes: { create: { scopeId: scope.id } },
          },
        })
      }
      // Consume all simultaneously eligible approvals for this address so an
      // older duplicate cannot silently restore a subsequently revoked grant.
      await tx.changelogPreapproval.updateMany({
        where: { id: { in: eligible.map(({ id }) => id) }, state: "pending" },
        data: {
          state: "redeemed",
          redeemedAt,
          redeemedById: input.userId,
          version: { increment: 1 },
        },
      })
      await tx.authAuditEvent.create({
        data: buildAuditEvent({
          eventType: "changelog_preapproval_redeemed",
          appId: environment.appId,
          subject: input.userId,
          metadata: {
            environmentId: environment.id,
            approvalIds: eligible.map(({ id }) => id),
          },
        }),
      })
    },
    { isolationLevel: "Serializable", maxWait: 1000, timeout: 6000 },
  )
}
