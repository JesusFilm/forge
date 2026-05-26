import Link from "next/link"
import type { Route } from "next"

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
    <section className="grid gap-[22px]">
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

      <div className="overflow-auto rounded-lg border border-[#dedbd2] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-[#ebe8df] p-[18px]">
          <h3 className="m-0 font-bold">Recent audit events</h3>
          <Link
            href={"/dashboard/audit" as Route}
            className="font-semibold text-[#b91c1c] no-underline"
          >
            View all
          </Link>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Event
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Severity
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {recentAuditEvents.map((event) => (
              <tr key={event.id}>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {event.eventType}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {event.severity.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {event.createdAt.toISOString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
