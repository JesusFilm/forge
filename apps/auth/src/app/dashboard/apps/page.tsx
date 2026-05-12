import Link from "next/link"
import type { Route } from "next"

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
    <section className="dashboard-section">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-kicker">Applications</p>
          <h2>Registered OAuth consumers</h2>
        </div>
      </header>

      <div className="list-stack">
        {apps.map((app) => (
          <article className="data-panel" key={app.id}>
            <div className="panel-heading">
              <div>
                <h3>{app.displayName}</h3>
                <p>{app.key}</p>
              </div>
              <Link href={`/dashboard/apps/${app.id}` as Route}>Open</Link>
            </div>
            <div className="tag-row">
              <span>{app.trustTier.toLowerCase()}</span>
              <span>{app.ownerType.toLowerCase()}</span>
              <span>{app.status.toLowerCase()}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Environment</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Default scopes</th>
                </tr>
              </thead>
              <tbody>
                {app.environments.map((environment) => (
                  <tr key={environment.id}>
                    <td>{environment.kind.toLowerCase()}</td>
                    <td>{environment.clientId}</td>
                    <td>{environment.status.toLowerCase()}</td>
                    <td>{environment.defaultScopes.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </section>
  )
}
