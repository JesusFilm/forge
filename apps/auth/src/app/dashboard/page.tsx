import Link from "next/link"
import type { Route } from "next"

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

export default async function DashboardPage() {
  const [
    appCount,
    environmentCount,
    activeUserCount,
    activeTokenCount,
    recentAuditEvents,
  ] = await Promise.all([
    prisma.registeredApp.count(),
    prisma.appEnvironment.count(),
    prisma.user.count({ where: { membershipStatus: "ACTIVE" } }),
    prisma.tokenRecord.count({ where: { status: "ACTIVE" } }),
    prisma.authAuditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        eventType: true,
        severity: true,
        createdAt: true,
      },
    }),
  ])

  return (
    <DashboardPageShell>
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Operator overview
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">SSO control plane</h2>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-3 max-[820px]:grid-cols-1">
        <Link
          href={"/dashboard/apps" as Route}
          className="grid min-h-[118px] gap-3.5 rounded-lg border border-[#dedbd2] bg-white p-[18px] text-inherit no-underline"
        >
          <span className="font-noto-serif text-[#78716c]">
            Registered apps
          </span>
          <strong className="text-[34px] font-bold">{appCount}</strong>
        </Link>
        <Link
          href={"/dashboard/apps" as Route}
          className="grid min-h-[118px] gap-3.5 rounded-lg border border-[#dedbd2] bg-white p-[18px] text-inherit no-underline"
        >
          <span className="font-noto-serif text-[#78716c]">Environments</span>
          <strong className="text-[34px] font-bold">{environmentCount}</strong>
        </Link>
        <Link
          href={"/dashboard/users" as Route}
          className="grid min-h-[118px] gap-3.5 rounded-lg border border-[#dedbd2] bg-white p-[18px] text-inherit no-underline"
        >
          <span className="font-noto-serif text-[#78716c]">Active users</span>
          <strong className="text-[34px] font-bold">{activeUserCount}</strong>
        </Link>
        <Link
          href={"/dashboard/tokens" as Route}
          className="grid min-h-[118px] gap-3.5 rounded-lg border border-[#dedbd2] bg-white p-[18px] text-inherit no-underline"
        >
          <span className="font-noto-serif text-[#78716c]">Active tokens</span>
          <strong className="text-[34px] font-bold">{activeTokenCount}</strong>
        </Link>
      </div>

      <DashboardPanel>
        <DashboardPanelHeader>
          <h3 className="m-0 font-bold">Recent audit events</h3>
          <Link
            href={"/dashboard/audit" as Route}
            className="font-semibold text-[#b91c1c] no-underline"
          >
            View all
          </Link>
        </DashboardPanelHeader>
        <DashboardTable>
          <thead>
            <tr>
              <DashboardTh>Event</DashboardTh>
              <DashboardTh>Severity</DashboardTh>
              <DashboardTh>Created</DashboardTh>
            </tr>
          </thead>
          <tbody>
            {recentAuditEvents.map((event) => (
              <tr key={event.id}>
                <DashboardTd>{event.eventType}</DashboardTd>
                <DashboardTd>{event.severity.toLowerCase()}</DashboardTd>
                <DashboardTd>{event.createdAt.toISOString()}</DashboardTd>
              </tr>
            ))}
          </tbody>
        </DashboardTable>
      </DashboardPanel>
    </DashboardPageShell>
  )
}
