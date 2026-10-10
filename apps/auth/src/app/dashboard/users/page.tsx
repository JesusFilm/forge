import { prisma } from "@/db/client"

import {
  DashboardPageShell,
  DashboardPanel,
  DashboardTable,
  DashboardTd,
  DashboardTh,
} from "@/app/dashboard/dashboard-components"

export const dynamic = "force-dynamic"

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      email: true,
      membershipStatus: true,
      actorType: true,
      emailVerified: true,
      createdAt: true,
      grants: {
        select: {
          id: true,
          status: true,
          app: { select: { displayName: true } },
          environment: { select: { kind: true } },
        },
      },
    },
  })

  return (
    <DashboardPageShell>
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Membership
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">
            Users and app grants
          </h2>
        </div>
      </header>

      <DashboardPanel>
        <DashboardTable>
          <thead>
            <tr>
              <DashboardTh>User</DashboardTh>
              <DashboardTh>Status</DashboardTh>
              <DashboardTh>Actor</DashboardTh>
              <DashboardTh>Email</DashboardTh>
              <DashboardTh>Grants</DashboardTh>
              <DashboardTh>Created</DashboardTh>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <DashboardTd>
                  <strong>{user.name}</strong>
                  <small className="block text-[#78716c]">{user.email}</small>
                </DashboardTd>
                <DashboardTd>{user.membershipStatus.toLowerCase()}</DashboardTd>
                <DashboardTd>{user.actorType.toLowerCase()}</DashboardTd>
                <DashboardTd>
                  {user.emailVerified ? "verified" : "unverified"}
                </DashboardTd>
                <DashboardTd>
                  {user.grants.length === 0
                    ? "none"
                    : user.grants
                        .map(
                          (grant) =>
                            `${grant.app.displayName} ${grant.environment.kind.toLowerCase()} ${grant.status.toLowerCase()}`,
                        )
                        .join(", ")}
                </DashboardTd>
                <DashboardTd>{user.createdAt.toISOString()}</DashboardTd>
              </tr>
            ))}
          </tbody>
        </DashboardTable>
      </DashboardPanel>
    </DashboardPageShell>
  )
}
