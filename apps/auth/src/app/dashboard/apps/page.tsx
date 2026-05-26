import Link from "next/link"
import type { Route } from "next"

import {
  DashboardPageShell,
  DashboardPanelHeader,
  DashboardTable,
  DashboardTd,
  DashboardTh,
} from "@/app/dashboard/dashboard-components"

import { prisma } from "@/db/client"

export const dynamic = "force-dynamic"

export default async function AppsPage() {
  const apps = await prisma.registeredApp.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      environments: {
        orderBy: { kind: "asc" },
        select: {
          id: true,
          key: true,
          kind: true,
          clientId: true,
          status: true,
          defaultScopes: true,
        },
      },
    },
  })

  return (
    <DashboardPageShell>
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Applications
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">
            Registered OAuth consumers
          </h2>
        </div>
      </header>

      <div className="grid gap-4">
        {apps.map((app) => (
          <article
            className="overflow-auto rounded-lg border border-[#dedbd2] bg-white"
            key={app.id}
          >
            <DashboardPanelHeader>
              <div>
                <h3 className="m-0 font-bold">{app.displayName}</h3>
                <p className="font-noto-serif m-0 text-[#78716c]">{app.key}</p>
              </div>
              <Link
                href={`/dashboard/apps/${app.id}` as Route}
                className="font-semibold text-[#b91c1c] no-underline"
              >
                Open
              </Link>
            </DashboardPanelHeader>
            <div className="flex flex-wrap gap-2 px-[18px] pb-[18px]">
              <span className="rounded-full bg-[#f1f0ea] px-[9px] py-1 text-xs text-[#57534e]">
                {app.trustTier.toLowerCase()}
              </span>
              <span className="rounded-full bg-[#f1f0ea] px-[9px] py-1 text-xs text-[#57534e]">
                {app.ownerType.toLowerCase()}
              </span>
              <span className="rounded-full bg-[#f1f0ea] px-[9px] py-1 text-xs text-[#57534e]">
                {app.status.toLowerCase()}
              </span>
            </div>
            <DashboardTable>
              <thead>
                <tr>
                  <DashboardTh>Environment</DashboardTh>
                  <DashboardTh>Client</DashboardTh>
                  <DashboardTh>Status</DashboardTh>
                  <DashboardTh>Default scopes</DashboardTh>
                </tr>
              </thead>
              <tbody>
                {app.environments.map((environment) => (
                  <tr key={environment.id}>
                    <DashboardTd>{environment.kind.toLowerCase()}</DashboardTd>
                    <DashboardTd>{environment.clientId}</DashboardTd>
                    <DashboardTd>
                      {environment.status.toLowerCase()}
                    </DashboardTd>
                    <DashboardTd>
                      {environment.defaultScopes.join(", ")}
                    </DashboardTd>
                  </tr>
                ))}
              </tbody>
            </DashboardTable>
          </article>
        ))}
      </div>
    </DashboardPageShell>
  )
}
