import { prisma } from "@/db/client"

export const dynamic = "force-dynamic"

export default async function AuditPage() {
  const events = await prisma.authAuditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      actorUser: { select: { email: true, name: true } },
      app: { select: { displayName: true, key: true } },
    },
  })

  return (
    <section className="dashboard-section">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-kicker">Audit</p>
          <h2>Recent Auth events</h2>
        </div>
      </header>

      <div className="data-panel">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Severity</th>
              <th>Actor</th>
              <th>App</th>
              <th>Metadata</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.eventType}</td>
                <td>{event.severity.toLowerCase()}</td>
                <td>{event.actorUser?.email ?? "system"}</td>
                <td>{event.app?.displayName ?? "none"}</td>
                <td>
                  <code>{JSON.stringify(event.metadata)}</code>
                </td>
                <td>{event.createdAt.toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
