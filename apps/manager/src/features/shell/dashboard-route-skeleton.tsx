type DashboardRouteSkeletonVariant =
  | "coverage"
  | "jobs"
  | "job-detail"
  | "agents"

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <span className={`dashboard-route-skeleton-block ${className ?? ""}`} />
  )
}

function CoverageSkeleton() {
  return (
    <div className="studio-page studio-page--coverage dashboard-route-skeleton">
      <header className="studio-page-intro">
        <SkeletonBlock className="dashboard-route-skeleton-eyebrow" />
        <SkeletonBlock className="dashboard-route-skeleton-title dashboard-route-skeleton-title--wide" />
        <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--wide" />
      </header>

      <section className="dashboard-route-skeleton-card dashboard-route-skeleton-card--coverage">
        <SkeletonBlock className="dashboard-route-skeleton-bar" />
        <div className="dashboard-route-skeleton-row dashboard-route-skeleton-row--legend">
          <SkeletonBlock className="dashboard-route-skeleton-chip" />
          <SkeletonBlock className="dashboard-route-skeleton-chip" />
          <SkeletonBlock className="dashboard-route-skeleton-chip" />
        </div>
        <div className="dashboard-route-skeleton-coverage-body">
          <div className="dashboard-route-skeleton-copy-stack">
            <SkeletonBlock className="dashboard-route-skeleton-label" />
            <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--medium" />
          </div>
          <SkeletonBlock className="dashboard-route-skeleton-cta" />
        </div>
        <div className="dashboard-route-skeleton-empty">
          <SkeletonBlock className="dashboard-route-skeleton-title" />
          <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--medium" />
          <SkeletonBlock className="dashboard-route-skeleton-pill" />
        </div>
      </section>
    </div>
  )
}

function JobsSkeleton() {
  return (
    <div className="studio-page studio-page--jobs dashboard-route-skeleton">
      <section className="collection-card jobs-card dashboard-route-skeleton-card dashboard-route-skeleton-card--jobs">
        <header className="studio-page-intro studio-page-intro--with-actions">
          <div className="studio-page-intro-copy">
            <SkeletonBlock className="dashboard-route-skeleton-eyebrow" />
            <SkeletonBlock className="dashboard-route-skeleton-title" />
            <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--wide" />
          </div>
          <div className="studio-page-intro-actions dashboard-route-skeleton-intro-actions">
            <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--status" />
            <SkeletonBlock className="dashboard-route-skeleton-button" />
          </div>
        </header>

        <div className="dashboard-route-skeleton-table">
          <div className="dashboard-route-skeleton-table-head">
            <SkeletonBlock className="dashboard-route-skeleton-label" />
            <SkeletonBlock className="dashboard-route-skeleton-label" />
            <SkeletonBlock className="dashboard-route-skeleton-label" />
            <SkeletonBlock className="dashboard-route-skeleton-label" />
          </div>
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="dashboard-route-skeleton-table-row" key={index}>
              <SkeletonBlock className="dashboard-route-skeleton-cell dashboard-route-skeleton-cell--time" />
              <SkeletonBlock className="dashboard-route-skeleton-cell dashboard-route-skeleton-cell--source" />
              <div className="dashboard-route-skeleton-chip-row">
                <SkeletonBlock className="dashboard-route-skeleton-chip" />
                <SkeletonBlock className="dashboard-route-skeleton-chip" />
                <SkeletonBlock className="dashboard-route-skeleton-chip" />
              </div>
              <div className="dashboard-route-skeleton-progress">
                <div className="dashboard-route-skeleton-progress-track">
                  {Array.from({ length: 5 }).map((_, stepIndex) => (
                    <SkeletonBlock
                      className="dashboard-route-skeleton-dot"
                      key={stepIndex}
                    />
                  ))}
                </div>
                <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--status" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function JobDetailSkeleton() {
  return (
    <div className="studio-page studio-page--job-detail dashboard-route-skeleton">
      <header className="studio-page-intro">
        <SkeletonBlock className="dashboard-route-skeleton-eyebrow" />
        <SkeletonBlock className="dashboard-route-skeleton-title dashboard-route-skeleton-title--wide" />
        <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--wide" />
      </header>

      <section className="dashboard-route-skeleton-stack">
        <div className="dashboard-route-skeleton-card dashboard-route-skeleton-card--detail-summary">
          <div className="dashboard-route-skeleton-row">
            <SkeletonBlock className="dashboard-route-skeleton-pill" />
            <SkeletonBlock className="dashboard-route-skeleton-pill" />
            <SkeletonBlock className="dashboard-route-skeleton-pill" />
          </div>
        </div>
        <div className="dashboard-route-skeleton-card dashboard-route-skeleton-card--detail-table">
          <SkeletonBlock className="dashboard-route-skeleton-title dashboard-route-skeleton-title--section" />
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="dashboard-route-skeleton-detail-row" key={index}>
              <SkeletonBlock className="dashboard-route-skeleton-label" />
              <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--wide" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function AgentsSkeleton() {
  return (
    <div className="studio-page studio-page--agents dashboard-route-skeleton">
      <section className="collection-card jobs-card dashboard-route-skeleton-card dashboard-route-skeleton-card--agents">
        <header className="studio-page-intro">
          <SkeletonBlock className="dashboard-route-skeleton-eyebrow" />
          <SkeletonBlock className="dashboard-route-skeleton-title" />
          <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--wide" />
        </header>

        <div className="dashboard-route-skeleton-grid">
          <div className="dashboard-route-skeleton-panel">
            <SkeletonBlock className="dashboard-route-skeleton-title dashboard-route-skeleton-title--section" />
            <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--wide" />
            <SkeletonBlock className="dashboard-route-skeleton-input" />
            <SkeletonBlock className="dashboard-route-skeleton-input" />
            <SkeletonBlock className="dashboard-route-skeleton-input" />
            <SkeletonBlock className="dashboard-route-skeleton-button dashboard-route-skeleton-button--wide" />
          </div>
          <div className="dashboard-route-skeleton-panel">
            <SkeletonBlock className="dashboard-route-skeleton-title dashboard-route-skeleton-title--section" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="dashboard-route-skeleton-list-row" key={index}>
                <div className="dashboard-route-skeleton-copy-stack">
                  <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--medium" />
                  <SkeletonBlock className="dashboard-route-skeleton-copy dashboard-route-skeleton-copy--status" />
                </div>
                <SkeletonBlock className="dashboard-route-skeleton-pill" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export function DashboardRouteSkeleton({
  variant,
}: {
  variant: DashboardRouteSkeletonVariant
}) {
  return (
    <div
      className="dashboard-route-skeleton-shell"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading {variant.replace("-", " ")}</span>
      {variant === "coverage" ? <CoverageSkeleton /> : null}
      {variant === "jobs" ? <JobsSkeleton /> : null}
      {variant === "job-detail" ? <JobDetailSkeleton /> : null}
      {variant === "agents" ? <AgentsSkeleton /> : null}
    </div>
  )
}
