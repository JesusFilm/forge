import { prisma } from "@/db/client"

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
    <section className="dashboard-section">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-kicker">Membership</p>
          <h2>Users and app grants</h2>
        </div>
      </header>

      <div className="data-panel">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Email</th>
              <th>Grants</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </td>
                <td>{user.membershipStatus.toLowerCase()}</td>
                <td>{user.emailVerified ? "verified" : "unverified"}</td>
                <td>
                  {user.grants.length === 0
                    ? "none"
                    : user.grants
                        .map(
                          (grant) =>
                            `${grant.app.displayName} ${grant.environment.kind.toLowerCase()} ${grant.status.toLowerCase()}`,
                        )
                        .join(", ")}
                </td>
                <td>{user.createdAt.toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
