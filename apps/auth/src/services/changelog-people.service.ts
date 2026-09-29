import { withChangelogViewer } from "./changelog-contributors.service"

const roleScopes = [
  ["changelog:admin", "Admin"],
  ["changelog:submit", "Contributor"],
  ["changelog:read", "Reader"],
] as const

export async function listChangelogPeople(
  bearer: string | null,
  clientId: string,
) {
  return withChangelogViewer(
    bearer,
    clientId,
    async ({ tx, environment, kind, grants }) => {
      const now = new Date()
      // A grant record remains after its scopes are removed. It is the history
      // that keeps a former participant visible without restoring authority.
      const history = await tx.appGrant.findMany({
        where: {
          appId: environment.appId,
          environmentId: environment.id,
          subjectType: "USER",
          OR: [{ status: "APPROVED" }, { approvedAt: { not: null } }],
          user: {
            actorType: "HUMAN",
            membershipStatus: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
        include: { user: true },
      })
      const accounts = new Map<
        string,
        {
          id: string
          name: string
          email: string
          role: "Admin" | "Contributor" | "Reader" | "No Access"
          hasBlockingPreapproval: boolean
        }
      >()
      const scopesByUser = new Map<string, Set<string>>()
      for (const grant of grants) {
        if (!grant.userId) continue
        const scopes = scopesByUser.get(grant.userId) ?? new Set<string>()
        for (const { scope } of grant.scopes) scopes.add(scope.key)
        scopesByUser.set(grant.userId, scopes)
      }
      for (const record of history) {
        if (!record.user) continue
        const scopes = scopesByUser.get(record.user.id) ?? new Set<string>()
        const role =
          roleScopes.find(([scope]) => scopes.has(scope))?.[1] ?? "No Access"
        accounts.set(record.user.id, {
          id: record.user.id,
          name: record.user.name,
          email: record.user.email,
          role,
          hasBlockingPreapproval: false,
        })
      }

      const approvals = await tx.changelogPreapproval.findMany({
        where: { environmentId: environment.id, state: "pending" },
        orderBy: { createdAt: "desc" },
      })
      const recipients = await tx.user.findMany({
        where: {
          actorType: "HUMAN",
          emailVerified: true,
          OR: approvals.map(({ email }) => ({
            email: { equals: email, mode: "insensitive" as const },
          })),
        },
      })
      const byEmail = new Map<string, (typeof recipients)[number] | null>()
      for (const user of recipients) {
        const email = user.email.trim().toLowerCase()
        byEmail.set(email, byEmail.has(email) ? null : user)
      }
      const preapprovals = approvals.flatMap((approval) => {
        const recipient = byEmail.get(approval.email.trim().toLowerCase())
        // A verified inactive identity makes the approval ineligible for the
        // directory. An unverified match cannot establish association.
        if (
          recipient &&
          (recipient.membershipStatus === "SUSPENDED" ||
            recipient.membershipStatus === "DISABLED" ||
            (recipient.expiresAt && recipient.expiresAt <= now))
        )
          return []
        const account = recipient ? accounts.get(recipient.id) : undefined
        if (account) account.hasBlockingPreapproval = true
        return [
          {
            id: approval.id,
            email: approval.email,
            state:
              approval.expiresAt <= now
                ? ("expired" as const)
                : ("pending" as const),
            version: approval.version,
            expiresAt: approval.expiresAt,
            accountId: account?.id ?? null,
          },
        ]
      })
      return {
        environment: kind.toLowerCase(),
        accounts: [...accounts.values()].sort((a, b) =>
          a.email.localeCompare(b.email),
        ),
        preapprovals,
      }
    },
  )
}
