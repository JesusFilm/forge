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
    <section className="dashboard-section">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-kicker">Operator overview</p>
          <h2>SSO control plane</h2>
        </div>
      </header>

      <div className="metric-grid">
        <Link href={"/dashboard/apps" as Route} className="metric-card">
          <span>Registered apps</span>
          <strong>{appCount}</strong>
        </Link>
        <Link href={"/dashboard/apps" as Route} className="metric-card">
          <span>Environments</span>
          <strong>{environmentCount}</strong>
        </Link>
        <Link href={"/dashboard/users" as Route} className="metric-card">
          <span>Active users</span>
          <strong>{activeUserCount}</strong>
        </Link>
        <Link href={"/dashboard/tokens" as Route} className="metric-card">
          <span>Active tokens</span>
          <strong>{activeTokenCount}</strong>
        </Link>
      </div>

      <div className="data-panel">
        <div className="panel-heading">
          <h3>Recent audit events</h3>
          <Link href={"/dashboard/audit" as Route}>View all</Link>
        </div>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Severity</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {recentAuditEvents.map((event) => (
              <tr key={event.id}>
                <td>{event.eventType}</td>
                <td>{event.severity.toLowerCase()}</td>
                <td>{event.createdAt.toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
