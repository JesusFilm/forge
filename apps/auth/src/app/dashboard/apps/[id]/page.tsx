import { notFound } from "next/navigation"

import {
  DashboardPageShell,
  DashboardPanel,
  DashboardPanelHeader,
  DashboardTable,
  DashboardTd,
  DashboardTh,
} from "@/app/dashboard/dashboard-components"

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
    <DashboardPageShell>
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Application
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">{app.displayName}</h2>
        </div>
      </header>

      <DashboardPanel>
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
      </DashboardPanel>

      <DashboardPanel>
        <DashboardPanelHeader>
          <h3 className="m-0 font-bold">Environments</h3>
        </DashboardPanelHeader>
        <DashboardTable>
          <thead>
            <tr>
              <DashboardTh>Key</DashboardTh>
              <DashboardTh>Kind</DashboardTh>
              <DashboardTh>Client</DashboardTh>
              <DashboardTh>Status</DashboardTh>
              <DashboardTh>Redirect URLs</DashboardTh>
            </tr>
          </thead>
          <tbody>
            {app.environments.map((environment) => (
              <tr key={environment.id}>
                <DashboardTd>{environment.key}</DashboardTd>
                <DashboardTd>{environment.kind.toLowerCase()}</DashboardTd>
                <DashboardTd>{environment.clientId}</DashboardTd>
                <DashboardTd>{environment.status.toLowerCase()}</DashboardTd>
                <DashboardTd>{environment.redirectUris.join(", ")}</DashboardTd>
              </tr>
            ))}
          </tbody>
        </DashboardTable>
      </DashboardPanel>

      <DashboardPanel>
        <DashboardPanelHeader>
          <h3 className="m-0 font-bold">Recent grants</h3>
        </DashboardPanelHeader>
        <DashboardTable>
          <thead>
            <tr>
              <DashboardTh>Subject</DashboardTh>
              <DashboardTh>Environment</DashboardTh>
              <DashboardTh>Status</DashboardTh>
              <DashboardTh>Scopes</DashboardTh>
            </tr>
          </thead>
          <tbody>
            {app.grants.map((grant) => (
              <tr key={grant.id}>
                <DashboardTd>
                  {grant.user?.email ??
                    grant.serviceKey ??
                    grant.subjectType.toLowerCase()}
                </DashboardTd>
                <DashboardTd>
                  {grant.environment.kind.toLowerCase()}
                </DashboardTd>
                <DashboardTd>{grant.status.toLowerCase()}</DashboardTd>
                <DashboardTd>
                  {grant.scopes
                    .map((grantScope) => grantScope.scope.key)
                    .join(", ")}
                </DashboardTd>
              </tr>
            ))}
          </tbody>
        </DashboardTable>
      </DashboardPanel>
    </DashboardPageShell>
  )
}
