import Link from "next/link"
import type { Route } from "next"

import {
  grantSubjectLabel,
  listAppAccessGrants,
  listLegacyAccessSurfaces,
  summarizeAccessControl,
} from "@/data/access-control"
import { formatEnum } from "@/data/app-registry"
import { requireDeveloperSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function AccessPage() {
  const session = await requireDeveloperSession("/access")
  const [grants, legacySurfaces] = await Promise.all([
    listAppAccessGrants(),
    Promise.resolve(listLegacyAccessSurfaces()),
  ])
  const summary = summarizeAccessControl(grants, legacySurfaces)

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Developer navigation">
        <div>
          <p className="eyebrow">Jesus Film</p>
          <h1>Developer</h1>
        </div>
        <nav>
          <Link href="/">Apps</Link>
          <Link href={"/access" as Route}>Access</Link>
        </nav>
        <div className="sidebar-note">
          <span>Signed in</span>
          <strong>{session.email ?? session.name ?? "Developer"}</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">Access control</p>
            <h2>Users and permissions</h2>
          </div>
          <div className="header-meta">Auth-owned grants</div>
          <Link className="secondary-link" href={"/api/auth/logout" as Route}>
            Sign out
          </Link>
        </header>

        <section className="metrics" aria-label="Access summary">
          <div>
            <span>Total grants</span>
            <strong>{summary.grantCount}</strong>
          </div>
          <div>
            <span>Approved</span>
            <strong>{summary.approvedGrantCount}</strong>
          </div>
          <div>
            <span>Pending</span>
            <strong>{summary.pendingGrantCount}</strong>
          </div>
          <div>
            <span>Migration targets</span>
            <strong>{summary.legacySurfaceCount}</strong>
          </div>
        </section>

        <section className="table-panel" aria-label="Auth-owned app grants">
          <div className="panel-heading">
            <h3>Auth grants</h3>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>App</th>
                  <th>Environment</th>
                  <th>Status</th>
                  <th>Scopes</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id}>
                    <td>
                      <strong>{grantSubjectLabel(grant)}</strong>
                      <small>{formatEnum(grant.subjectType)}</small>
                    </td>
                    <td>
                      <strong>{grant.appName}</strong>
                      <small>{grant.appKey}</small>
                    </td>
                    <td>{formatEnum(grant.environmentKind)}</td>
                    <td>
                      <span className="status-pill" data-state={grant.status}>
                        {formatEnum(grant.status)}
                      </span>
                    </td>
                    <td>{grant.scopes.join(", ") || "none"}</td>
                    <td>{grant.reason ?? "-"}</td>
                  </tr>
                ))}
                {grants.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No Auth-owned grants recorded.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="table-panel" aria-label="Legacy access controls">
          <div className="panel-heading">
            <h3>Controls to consolidate</h3>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  <th>Current surface</th>
                  <th>Current owner</th>
                  <th>Target</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {legacySurfaces.map((surface) => (
                  <tr key={surface.key}>
                    <td>
                      <strong>{surface.appName}</strong>
                      <small>{surface.appKey}</small>
                    </td>
                    <td>
                      <code>{surface.surface}</code>
                    </td>
                    <td>{surface.currentOwner}</td>
                    <td>{surface.migrationTarget}</td>
                    <td>
                      <span className="status-pill" data-state="pending">
                        {formatEnum(surface.status)}
                      </span>
                    </td>
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
