import Link from "next/link"
import type { Route } from "next"

import {
  formatEnum,
  listRegisteredApps,
  summarizeRegistry,
} from "@/data/app-registry"
import { env } from "@/config/env"
import { RegistryDisabled } from "./registry-disabled"

export const dynamic = "force-dynamic"

export default async function DeveloperHomePage() {
  if (env.DEVELOPER_REGISTRY_MODE !== "readonly") {
    return <RegistryDisabled />
  }

  const apps = await listRegisteredApps()
  const summary = summarizeRegistry(apps)

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
          <span>Auth owned</span>
          <strong>Read-only registry</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">App Registry</p>
            <h2>OAuth registrations</h2>
          </div>
          <div className="header-meta">developer.jesusfilm.org</div>
        </header>

        <section className="metrics" aria-label="Registry summary">
          <div>
            <span>Apps</span>
            <strong>{summary.appCount}</strong>
          </div>
          <div>
            <span>Environments</span>
            <strong>{summary.environmentCount}</strong>
          </div>
          <div>
            <span>Production</span>
            <strong>{summary.productionCount}</strong>
          </div>
          <div>
            <span>Pending review</span>
            <strong>{summary.pendingReviewCount}</strong>
          </div>
        </section>

        <section className="app-list" aria-label="Registered apps">
          {apps.map((app) => (
            <article className="app-row" key={app.id}>
              <div className="app-row-main">
                <div>
                  <p className="app-key">{app.key}</p>
                  <h3>{app.displayName}</h3>
                  <p>{app.description ?? "No description provided."}</p>
                </div>
                <Link href={`/apps/${app.id}` as Route}>Open</Link>
              </div>
              <div className="tag-row">
                <span>{formatEnum(app.trustTier)}</span>
                <span>{formatEnum(app.ownerType)}</span>
                <span data-state={app.status}>{formatEnum(app.status)}</span>
              </div>
              <div className="environment-strip">
                {app.environments.map((environment) => (
                  <div key={environment.id}>
                    <span>{formatEnum(environment.kind)}</span>
                    <strong data-state={environment.status}>
                      {formatEnum(environment.status)}
                    </strong>
                    <small>{environment.clientId}</small>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  )
}
