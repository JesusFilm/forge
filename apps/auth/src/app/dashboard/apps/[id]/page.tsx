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
    <section className="dashboard-section">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-kicker">Application</p>
          <h2>{app.displayName}</h2>
        </div>
      </header>

      <div className="data-panel">
        <div className="detail-grid">
          <div>
            <span>Key</span>
            <strong>{app.key}</strong>
          </div>
          <div>
            <span>Trust tier</span>
            <strong>{app.trustTier.toLowerCase()}</strong>
          </div>
          <div>
            <span>Owner</span>
            <strong>{app.ownerName ?? app.ownerType.toLowerCase()}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{app.status.toLowerCase()}</strong>
          </div>
        </div>
      </div>

      <div className="data-panel">
        <div className="panel-heading">
          <h3>Environments</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Kind</th>
              <th>Client</th>
              <th>Status</th>
              <th>Redirect URLs</th>
            </tr>
          </thead>
          <tbody>
            {app.environments.map((environment) => (
              <tr key={environment.id}>
                <td>{environment.key}</td>
                <td>{environment.kind.toLowerCase()}</td>
                <td>{environment.clientId}</td>
                <td>{environment.status.toLowerCase()}</td>
                <td>{environment.redirectUris.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="data-panel">
        <div className="panel-heading">
          <h3>Recent grants</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Environment</th>
              <th>Status</th>
              <th>Scopes</th>
            </tr>
          </thead>
          <tbody>
            {app.grants.map((grant) => (
              <tr key={grant.id}>
                <td>
                  {grant.user?.email ??
                    grant.serviceKey ??
                    grant.subjectType.toLowerCase()}
                </td>
                <td>{grant.environment.kind.toLowerCase()}</td>
                <td>{grant.status.toLowerCase()}</td>
                <td>
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
