import { CheckCircle2 } from "lucide-react"
import type { SeoRunPage } from "./seo-contract"
import { SeoRunsView } from "./seo-runs-view"
import { SeoWorkspaceTabs } from "./seo-workspace-tabs"

export function SeoRunsPage({
  page,
  loadError,
  cursor,
  isDemo,
}: {
  page: SeoRunPage
  loadError?: string
  cursor?: string
  isDemo: boolean
}) {
  return (
    <section className="seo-workspace" aria-labelledby="seo-workspace-title">
      <header className="seo-workspace-hero">
        <div>
          <span className="studio-page-eyebrow">
            Search growth · human controlled
          </span>
          <h1 id="seo-workspace-title">SEO workspace</h1>
          <p>
            Review evidence-backed actions, preserve exact decisions, and follow
            outcomes without granting an agent publish or deployment authority.
          </p>
        </div>
        <div className="seo-workspace-mode">
          <span
            className={`seo-status-badge ${isDemo || loadError ? "is-warning" : "is-success"}`}
          >
            <CheckCircle2 aria-hidden="true" size={15} />
            {isDemo ? "Demo data" : loadError ? "Unavailable" : "Admin ledger"}
          </span>
          <small>
            Bounded Admin-owned summaries; provider response bodies are never
            returned.
          </small>
        </div>
      </header>
      <SeoWorkspaceTabs view="runs" />
      <div
        className="seo-view-panel"
        role="tabpanel"
        id="seo-panel-runs"
        aria-labelledby="seo-tab-runs"
      >
        <SeoRunsView page={page} loadError={loadError} cursor={cursor} />
      </div>
    </section>
  )
}
