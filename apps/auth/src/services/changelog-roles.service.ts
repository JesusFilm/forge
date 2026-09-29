import { buildAuditEvent } from "./audit.service"
import {
  ContributorManagementError,
  withChangelogAdmin,
} from "./changelog-contributors.service"

export type ChangelogRole = "Admin" | "Contributor" | "Reader" | "No Access"

const roleScopes: Record<ChangelogRole, string[]> = {
  Admin: ["changelog:admin", "changelog:submit", "changelog:read"],
  Contributor: ["changelog:submit", "changelog:read"],
  Reader: ["changelog:read"],
  "No Access": [],
}

export async function setChangelogRole(
  bearer: string | null,
  clientId: string,
  recipientId: string,
  role: ChangelogRole,
  confirmSelfDemotion: boolean,
) {
  return withChangelogAdmin(
    bearer,
    clientId,
    async ({ tx, environment, actorId, grants }) => {
      // Membership updates can run outside Changelog. Lock both identities
      // while checking eligibility and changing grants.
      await tx.$queryRaw`
        SELECT id FROM "user"
        WHERE id IN (${actorId}, ${recipientId})
        ORDER BY id FOR UPDATE
      `
      const now = new Date()
      const actor = await tx.user.findUnique({ where: { id: actorId } })
      if (
        !actor ||
        actor.actorType !== "HUMAN" ||
        actor.membershipStatus !== "ACTIVE" ||
        (actor.expiresAt && actor.expiresAt <= now)
      )
        throw new ContributorManagementError(403, "access-denied")
      const recipient = await tx.user.findUnique({ where: { id: recipientId } })
      if (
        !recipient ||
        recipient.actorType !== "HUMAN" ||
        recipient.membershipStatus !== "ACTIVE" ||
        (recipient.expiresAt && recipient.expiresAt <= now)
      )
        throw new ContributorManagementError(409, "recipient-ineligible")

      const history = await tx.appGrant.findFirst({
        where: {
          appId: environment.appId,
          environmentId: environment.id,
          subjectType: "USER",
          userId: recipientId,
          OR: [{ status: "APPROVED" }, { approvedAt: { not: null } }],
        },
      })
      if (!history)
        throw new ContributorManagementError(409, "recipient-ineligible")

      // Only a verified current email establishes an approval association.
      // Expired approvals remain pending in storage until explicitly resolved.
      const blockingApproval = await tx.changelogPreapproval.findFirst({
        where: {
          environmentId: environment.id,
          email: { equals: recipient.email, mode: "insensitive" },
          state: "pending",
        },
      })
      if (recipient.emailVerified && blockingApproval)
        throw new ContributorManagementError(409, "preapproval-blocked")

      const activeGrants = grants.filter(
        (grant) => grant.userId === recipientId,
      )
      const changelogScopes = [
        "changelog:admin",
        "changelog:submit",
        "changelog:read",
      ]
      const currentScopes = new Set(
        activeGrants.flatMap((grant) =>
          grant.scopes
            .map(({ scope }) => scope.key)
            .filter((key) => changelogScopes.includes(key)),
        ),
      )
      const nextScopes = roleScopes[role]
      if (
        actorId === recipientId &&
        currentScopes.has("changelog:admin") &&
        role !== "Admin"
      ) {
        if (!confirmSelfDemotion)
          throw new ContributorManagementError(409, "confirmation-required")
        const otherAdmins = new Set(
          grants
            .filter(
              (grant) =>
                grant.userId !== actorId &&
                grant.user?.actorType === "HUMAN" &&
                grant.user.membershipStatus === "ACTIVE" &&
                (!grant.user.expiresAt || grant.user.expiresAt > now) &&
                grant.scopes.some(
                  ({ scope }) => scope.key === "changelog:admin",
                ),
            )
            .map((grant) => grant.userId),
        )
        if (otherAdmins.size === 0)
          throw new ContributorManagementError(409, "last-admin")
      }

      const unchanged =
        currentScopes.size === nextScopes.length &&
        nextScopes.every((scope) => currentScopes.has(scope))
      if (unchanged) return { changed: false, role }

      const scopeRecords = await tx.scope.findMany({
        where: {
          key: { in: changelogScopes },
        },
      })
      if (scopeRecords.length !== 3)
        throw new ContributorManagementError(503, "management-unavailable")
      const changelogScopeIds = scopeRecords.map(({ id }) => id)
      await tx.appGrantScope.deleteMany({
        where: {
          grantId: { in: activeGrants.map(({ id }) => id) },
          scopeId: { in: changelogScopeIds },
        },
      })
      if (nextScopes.length) {
        const grant =
          activeGrants[0] ??
          (await tx.appGrant.create({
            data: {
              appId: environment.appId,
              environmentId: environment.id,
              subjectType: "USER",
              userId: recipientId,
              status: "APPROVED",
              approvedAt: now,
              reason: "Changelog People role assignment",
            },
          }))
        await tx.appGrantScope.createMany({
          data: nextScopes.map((key) => ({
            grantId: grant.id,
            scopeId: scopeRecords.find((scope) => scope.key === key)!.id,
          })),
        })
      }
      await tx.authAuditEvent.create({
        data: buildAuditEvent({
          eventType: "changelog_role_changed",
          appId: environment.appId,
          subject: recipientId,
          metadata: { actorId, environmentId: environment.id, role },
        }),
      })
      return { changed: true, role }
    },
  )
}
