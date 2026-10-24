import { prisma } from "@/db/client"

import {
  DashboardPageShell,
  DashboardPanel,
  DashboardTable,
  DashboardTd,
  DashboardTh,
} from "@/app/dashboard/dashboard-components"

export const dynamic = "force-dynamic"

export default async function AuditPage() {
  const events = await prisma.authAuditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      actorUser: { select: { actorType: true, email: true, name: true } },
      app: { select: { displayName: true, key: true } },
    },
  })

  return (
    <DashboardPageShell>
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Audit
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">Recent Auth events</h2>
        </div>
      </header>

      <DashboardPanel>
        <DashboardTable>
          <thead>
            <tr>
              <DashboardTh>Event</DashboardTh>
              <DashboardTh>Severity</DashboardTh>
              <DashboardTh>Actor</DashboardTh>
              <DashboardTh>App</DashboardTh>
              <DashboardTh>Metadata</DashboardTh>
              <DashboardTh>Created</DashboardTh>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <DashboardTd>{event.eventType}</DashboardTd>
                <DashboardTd>{event.severity.toLowerCase()}</DashboardTd>
                <DashboardTd>
                  {event.actorUser
                    ? `${event.actorUser.email} (${event.actorUser.actorType.toLowerCase()})`
                    : "system"}
                </DashboardTd>
                <DashboardTd>{event.app?.displayName ?? "none"}</DashboardTd>
                <DashboardTd>
                  <code className="whitespace-normal break-words">
                    {JSON.stringify(event.metadata)}
                  </code>
                </DashboardTd>
                <DashboardTd>{event.createdAt.toISOString()}</DashboardTd>
              </tr>
            ))}
          </tbody>
        </DashboardTable>
      </DashboardPanel>
    </DashboardPageShell>
  )
}
