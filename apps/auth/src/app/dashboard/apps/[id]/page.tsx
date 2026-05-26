import { notFound } from "next/navigation"

import { prisma } from "@/db/client"

export const dynamic = "force-dynamic"

export default async function AppDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const app = await prisma.registeredApp.findUnique({
    where: { id },
    include: {
      environments: { orderBy: { createdAt: "asc" } },
      grants: {
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          user: { select: { email: true, name: true } },
          scopes: { include: { scope: true } },
          environment: { select: { key: true, kind: true } },
        },
      },
    },
  })

  if (!app) notFound()

  return (
    <section className="grid gap-[22px]">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Application
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">{app.displayName}</h2>
        </div>
      </header>

      <div className="overflow-auto rounded-lg border border-[#dedbd2] bg-white">
        <div className="grid grid-cols-4 gap-3.5 p-[18px] max-[820px]:grid-cols-1">
          <div className="grid gap-1">
            <span className="font-noto-serif text-xs text-[#78716c]">Key</span>
            <strong>{app.key}</strong>
          </div>
          <div className="grid gap-1">
            <span className="font-noto-serif text-xs text-[#78716c]">
              Trust tier
            </span>
            <strong>{app.trustTier.toLowerCase()}</strong>
          </div>
          <div className="grid gap-1">
            <span className="font-noto-serif text-xs text-[#78716c]">
              Owner
            </span>
            <strong>{app.ownerName ?? app.ownerType.toLowerCase()}</strong>
          </div>
          <div className="grid gap-1">
            <span className="font-noto-serif text-xs text-[#78716c]">
              Status
            </span>
            <strong>{app.status.toLowerCase()}</strong>
          </div>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-[#dedbd2] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-[#ebe8df] p-[18px]">
          <h3 className="m-0 font-bold">Environments</h3>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Key
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Kind
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Client
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Status
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Redirect URLs
              </th>
            </tr>
          </thead>
          <tbody>
            {app.environments.map((environment) => (
              <tr key={environment.id}>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {environment.key}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {environment.kind.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {environment.clientId}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {environment.status.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {environment.redirectUris.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-auto rounded-lg border border-[#dedbd2] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-[#ebe8df] p-[18px]">
          <h3 className="m-0 font-bold">Recent grants</h3>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Subject
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Environment
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Status
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Scopes
              </th>
            </tr>
          </thead>
          <tbody>
            {app.grants.map((grant) => (
              <tr key={grant.id}>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {grant.user?.email ??
                    grant.serviceKey ??
                    grant.subjectType.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {grant.environment.kind.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {grant.status.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {grant.scopes
                    .map((grantScope) => grantScope.scope.key)
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
