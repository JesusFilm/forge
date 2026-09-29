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
      const emails = [
        ...new Set(approvals.map(({ email }) => email.trim().toLowerCase())),
      ]
      // Bind the growing approval set once; Prisma OR filters create one
      // parameter per email and cannot use the normalized-email index.
      const recipients = emails.length
        ? await tx.$queryRaw<
            {
              id: string
              email: string
              ineligible: boolean
            }[]
          >`
            SELECT u.id, u.email,
                   (u.membership_status IN ('suspended', 'disabled') OR
                    (u.expires_at IS NOT NULL AND u.expires_at <= ${now})) AS ineligible
            FROM "user" AS u
            WHERE lower(u.email) = ANY(ARRAY(
              SELECT jsonb_array_elements_text(${JSON.stringify(emails)}::jsonb)
            ))
              AND u.actor_type = 'human' AND u.email_verified = true
          `
        : []
      const byEmail = new Map<string, (typeof recipients)[number] | null>()
      for (const user of recipients) {
        const email = user.email.trim().toLowerCase()
        byEmail.set(email, byEmail.has(email) ? null : user)
      }
      const preapprovals = approvals.flatMap((approval) => {
        const recipient = byEmail.get(approval.email.trim().toLowerCase())
        // A verified inactive identity makes the approval ineligible for the
        // directory. An unverified match cannot establish association.
        if (recipient?.ineligible) return []
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
