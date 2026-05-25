import Link from "next/link"
import { notFound } from "next/navigation"

import { formatEnum, getRegisteredApp } from "@/data/app-registry"
import { requireDeveloperSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function AppDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireDeveloperSession(`/apps/${id}`)
  const app = await getRegisteredApp(id)

  if (!app) notFound()

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Developer navigation">
        <div>
          <p className="eyebrow">Jesus Film</p>
          <h1>Developer</h1>
        </div>
        <nav>
          <Link href="/">Apps</Link>
        </nav>
        <div className="sidebar-note">
          <span>Signed in</span>
          <strong>{session.email ?? session.name ?? "Developer"}</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">{app.key}</p>
            <h2>{app.displayName}</h2>
          </div>
          <Link className="secondary-link" href="/">
            Back
          </Link>
        </header>

        <section className="detail-grid" aria-label="App metadata">
          <div>
            <span>Owner</span>
            <strong>{app.ownerName ?? formatEnum(app.ownerType)}</strong>
          </div>
          <div>
            <span>Trust tier</span>
            <strong>{formatEnum(app.trustTier)}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{formatEnum(app.status)}</strong>
          </div>
          <div>
            <span>Environments</span>
            <strong>{app.environments.length}</strong>
          </div>
        </section>

        <section className="table-panel" aria-label="OAuth environments">
          <div className="panel-heading">
            <h3>Environments</h3>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Environment</th>
                  <th>Client ID</th>
                  <th>Status</th>
                  <th>Scopes</th>
                  <th>Redirect URIs</th>
                  <th>Allowed origins</th>
                </tr>
              </thead>
              <tbody>
                {app.environments.map((environment) => (
                  <tr key={environment.id}>
                    <td>
                      <strong>{formatEnum(environment.kind)}</strong>
                      <small>{environment.key}</small>
                    </td>
                    <td>
                      <code>{environment.clientId}</code>
                    </td>
                    <td>
                      <span
                        className="status-pill"
                        data-state={environment.status}
                      >
                        {formatEnum(environment.status)}
                      </span>
                    </td>
                    <td>{environment.defaultScopes.join(", ")}</td>
                    <td>{environment.redirectUris.join(", ")}</td>
                    <td>{environment.allowedOrigins.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  )
}
