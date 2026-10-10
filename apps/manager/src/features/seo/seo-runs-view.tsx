import Link from "next/link"
import type { Route } from "next"
import { ArrowRight, CheckCircle2, CircleDashed, History } from "lucide-react"
import type {
  SeoRunPage,
  SeoRunReportAvailability,
  SeoRunSummary,
} from "./seo-contract"
import { formatSeoDate } from "./seo-presenter"

function availabilityLabel(value: SeoRunReportAvailability): string {
  return {
    running: "Collecting",
    available: "Detail available",
    legacy_unavailable: "Legacy summary",
    malformed: "Detail unavailable",
    unsupported_version: "Newer report version",
    detail_expired: "Detail expired",
    detail_suppressed_retention_unhealthy: "Detail suppressed",
  }[value]
}

function runTone(run: SeoRunSummary): "success" | "warning" | "danger" {
  if (run.status === "FAILED") return "danger"
  if (run.status === "PARTIAL" || run.reportAvailability !== "available") {
    return "warning"
  }
  return "success"
}

function coverageSummary(coverage: Record<string, unknown>): string {
  const entries = Object.entries(coverage)
  if (entries.length === 0) return "No provider coverage recorded"
  return entries
    .slice(0, 4)
    .map(([provider, status]) => `${provider}: ${String(status)}`)
    .join(" · ")
}

export function SeoRunsView({
  page,
  loadError,
  cursor,
}: {
  page: SeoRunPage
  loadError?: string
  cursor?: string
}) {
  const returnTo = cursor
    ? `/dashboard/seo?view=runs&cursor=${encodeURIComponent(cursor)}`
    : "/dashboard/seo?view=runs"

  return (
    <div className="seo-view-stack">
      <div className="seo-view-heading">
        <div>
          <span className="seo-section-eyebrow">All jobs</span>
          <h2>Run audit log</h2>
          <p>
            One durable record per SEO job: provider scope, evaluated query
            candidates, machine decisions, and linked proposal outcomes.
          </p>
        </div>
        <span className="seo-generated-at">
          Snapshot {formatSeoDate(page.generatedAt)}
        </span>
      </div>

      {loadError ? (
        <div className="seo-run-alert" role="alert">
          <CircleDashed aria-hidden="true" size={20} />
          <div>
            <strong>Run log unavailable</strong>
            <p>{loadError}</p>
          </div>
        </div>
      ) : page.items.length === 0 ? (
        <div className="seo-empty-state">
          <CheckCircle2 aria-hidden="true" size={30} />
          <strong>No retained SEO runs</strong>
          <p>
            The first completed or in-progress daily audit will appear here.
          </p>
        </div>
      ) : (
        <div className="seo-run-list" aria-label="SEO run history">
          {page.items.map((run) => (
            <Link
              key={run.id}
              className="seo-run-row"
              href={
                `/dashboard/seo/runs/${encodeURIComponent(run.id)}?returnTo=${encodeURIComponent(returnTo)}` as Route
              }
            >
              <span className="seo-run-row-icon">
                <History aria-hidden="true" size={20} />
              </span>
              <span className="seo-run-row-main">
                <span className="seo-run-row-topline">
                  <strong>{formatSeoDate(run.startedAt)}</strong>
                  <span className={`seo-status-badge is-${runTone(run)}`}>
                    {run.status.toLowerCase()}
                  </span>
                  <span className="seo-status-badge">
                    {run.mode.toLowerCase().replace("_", "-")}
                  </span>
                  {run.reclaimed ? (
                    <span className="seo-status-badge is-warning">
                      reclaimed
                    </span>
                  ) : null}
                </span>
                <small>{coverageSummary(run.providerCoverage)}</small>
                <span className="seo-run-row-counts">
                  {run.eligibleCount} targets · {run.selectedCount} selected ·{" "}
                  {run.wouldProposeCount} proposal candidates ·{" "}
                  {availabilityLabel(run.reportAvailability)}
                </span>
              </span>
              <ArrowRight aria-hidden="true" size={20} />
            </Link>
          ))}
        </div>
      )}

      <nav className="seo-run-pagination" aria-label="SEO run pages">
        {cursor ? (
          <Link href={"/dashboard/seo?view=runs" as Route}>First page</Link>
        ) : (
          <span />
        )}
        {page.hasNextPage && page.nextCursor ? (
          <Link
            href={
              `/dashboard/seo?view=runs&cursor=${encodeURIComponent(page.nextCursor)}` as Route
            }
          >
            Older runs <ArrowRight aria-hidden="true" size={16} />
          </Link>
        ) : null}
      </nav>
    </div>
  )
}
