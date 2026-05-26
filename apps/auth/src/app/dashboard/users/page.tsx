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
    <section className="grid gap-[22px]">
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

      <div className="overflow-auto rounded-lg border border-[#dedbd2] bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                User
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Status
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Email
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Grants
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  <strong>{user.name}</strong>
                  <small className="block text-[#78716c]">{user.email}</small>
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {user.membershipStatus.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {user.emailVerified ? "verified" : "unverified"}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {user.grants.length === 0
                    ? "none"
                    : user.grants
                        .map(
                          (grant) =>
                            `${grant.app.displayName} ${grant.environment.kind.toLowerCase()} ${grant.status.toLowerCase()}`,
                        )
                        .join(", ")}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {user.createdAt.toISOString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
