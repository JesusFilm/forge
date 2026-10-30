import Link from "next/link"
import { AlertTriangle, CheckCircle2, ExternalLink, Radar } from "lucide-react"
import {
  classifyPublicWatchPathname,
  PUBLIC_WATCH_ORIGIN,
} from "@forge/watch-url-policy/routes"
import type {
  WatchRouteAlertItem,
  WatchRouteAlertsPage,
} from "./watch-route-alert-contract"

const severityLabel = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Review",
} as const

function formatDate(value: string | null) {
  if (!value) return "Never"
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))
}

function countLabel(item: WatchRouteAlertItem) {
  return item.countKind === "EVENT_COUNT"
    ? `${item.count.toLocaleString()} events`
    : `${item.count.toLocaleString()} views`
}

export function safeWatchUrl(path: string): string | null {
  const classification = classifyPublicWatchPathname(path)
  if (classification.kind !== "page") {
    return null
  }
  return `${PUBLIC_WATCH_ORIGIN}${classification.normalizedPathname}`
}

function StateNotice({ page }: { page: WatchRouteAlertsPage }) {
  if (page.monitorState === "NEVER_RUN") {
    return (
      <div className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5">
        <p className="font-semibold text-[color:var(--ds-ink)]">
          Monitoring has not run yet.
        </p>
        <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
          Enable the Watch route workflow after its Admin receiver and GA4
          credentials are ready.
        </p>
      </div>
    )
  }
  if (page.monitorState === "PARTIAL" || page.monitorState === "UNAVAILABLE") {
    return (
      <div className="flex gap-3 rounded-[var(--ds-radius)] border border-[color:var(--ds-danger)] bg-[color:color-mix(in_srgb,var(--ds-danger)_7%,var(--ds-panel))] p-4">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--ds-danger)]"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-[color:var(--ds-ink)]">
            {page.monitorState === "PARTIAL"
              ? "Coverage is partial."
              : "The latest monitor run is unavailable."}
          </p>
          <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
            Existing alerts remain visible. Recovery was suppressed so missing
            data is not mistaken for a fix. Last successful run:{" "}
            {formatDate(page.lastSuccessfulAt)} UTC.
          </p>
          {page.propertyRunsTruncated ? (
            <p className="mt-1 text-sm text-[color:var(--ds-danger)]">
              Property health reached the 100-property reporting cap.
            </p>
          ) : null}
        </div>
      </div>
    )
  }
  return null
}

export function WatchRouteAlertsReport({
  page,
  loadError,
}: {
  page: WatchRouteAlertsPage
  loadError?: string
}) {
  if (loadError) {
    return (
      <section
        className="mx-auto w-full max-w-[1500px] p-5 md:p-8"
        aria-labelledby="watch-alerts-title"
      >
        <h1
          id="watch-alerts-title"
          className="text-3xl font-semibold tracking-[-0.035em] text-[color:var(--ds-ink)]"
        >
          Watch route alerts
        </h1>
        <div className="mt-6 rounded-[var(--ds-radius)] border border-[color:var(--ds-danger)] bg-[color:color-mix(in_srgb,var(--ds-danger)_6%,var(--ds-panel))] p-5">
          <p className="font-semibold text-[color:var(--ds-ink)]">
            Alerts could not be loaded.
          </p>
          <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
            {loadError}
          </p>
        </div>
      </section>
    )
  }

  const isHealthyEmpty =
    page.monitorState === "HEALTHY" && page.items.length === 0
  const propertyRuns =
    page.propertyRuns.length > 0
      ? page.propertyRuns
      : page.latestRun
        ? [page.latestRun]
        : []
  return (
    <section
      className="mx-auto w-full max-w-[1500px] p-5 md:p-8"
      aria-labelledby="watch-alerts-title"
    >
      <header className="grid gap-6 border-b border-[color:var(--ds-line)] pb-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--ds-muted)]">
            <Radar className="h-4 w-4" aria-hidden="true" />
            Watch reliability
          </div>
          <h1
            id="watch-alerts-title"
            className="mt-3 text-4xl font-semibold tracking-[-0.045em] text-[color:var(--ds-ink)] md:text-5xl"
          >
            Route alerts
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[color:var(--ds-muted)]">
            GA4 not-found traffic checked against the current Watch route
            manifest and the live site.
          </p>
        </div>
        <div className="text-left lg:text-right">
          <p className="text-sm text-[color:var(--ds-muted)]">
            Last successful run
          </p>
          <p className="mt-1 font-semibold text-[color:var(--ds-ink)]">
            {formatDate(page.lastSuccessfulAt)} UTC
          </p>
        </div>
      </header>

      <div className="mt-6">
        <StateNotice page={page} />
      </div>

      <div className="mt-6 grid border-y border-[color:var(--ds-line)] sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Open", page.summary.open],
          ["Critical", page.summary.critical],
          ["Supported routes", page.summary.supportedRouteFailures],
          ["Needs review", page.summary.plausibleMissingRoutes],
          ["Recovered", page.summary.recovered],
        ].map(([label, value], index) => (
          <div
            key={label}
            className={`py-5 sm:px-5 ${index > 0 ? "sm:border-l sm:border-[color:var(--ds-line)]" : ""}`}
          >
            <p className="text-sm text-[color:var(--ds-muted)]">{label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-[color:var(--ds-ink)]">
              {value}
            </p>
          </div>
        ))}
      </div>

      {propertyRuns.map((run) => (
        <section className="mt-6" key={run.propertyId}>
          {propertyRuns.length > 1 ? (
            <h2 className="mb-3 text-sm font-semibold text-[color:var(--ds-muted)]">
              GA4 property {run.propertyId}
            </h2>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            {run.lanes.map((lane) => (
              <div
                key={lane.source}
                className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <p className="font-semibold text-[color:var(--ds-ink)]">
                    {lane.source === "EXPLICIT_EVENT"
                      ? "GA4 page_not_found"
                      : "Localized 404-title check"}
                  </p>
                  <span className="text-sm font-semibold text-[color:var(--ds-muted)]">
                    {lane.status.toLowerCase()}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
                  {lane.rowCount.toLocaleString()} rows ·{" "}
                  {lane.countKind === "EVENT_COUNT"
                    ? "event count"
                    : "page views"}{" "}
                  · {formatDate(lane.windowStart)}–{formatDate(lane.windowEnd)}{" "}
                  UTC
                </p>
                {lane.caveats.map((caveat) => (
                  <p
                    className="mt-2 text-sm text-[color:var(--ds-danger)]"
                    key={caveat}
                  >
                    {caveat}
                  </p>
                ))}
              </div>
            ))}
          </div>
          {run.validationCaveats.map((caveat) => (
            <p
              className="mt-2 text-sm text-[color:var(--ds-danger)]"
              key={caveat}
            >
              Validation coverage: {caveat}
            </p>
          ))}
        </section>
      ))}

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[color:var(--ds-ink)]">
            Surfaced issues
          </h2>
          <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
            Showing {page.showing.toLocaleString()} of{" "}
            {page.totalCount.toLocaleString()}
          </p>
        </div>
      </div>

      {isHealthyEmpty ? (
        <div className="mt-4 flex gap-3 rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 text-[color:var(--ds-success)]"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-[color:var(--ds-ink)]">
              No actionable Watch 404s found.
            </p>
            <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
              The latest complete run checked both GA4 evidence lanes.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)]">
          {page.items.map((item) => {
            const href = safeWatchUrl(item.path)
            return (
              <article
                key={item.id}
                className="grid border-b border-[color:var(--ds-line)] last:border-b-0 md:grid-cols-[6px_minmax(0,1fr)_auto]"
              >
                <div
                  className={
                    item.severity === "CRITICAL"
                      ? "bg-[color:var(--ds-danger)]"
                      : item.severity === "HIGH"
                        ? "bg-[color:color-mix(in_srgb,var(--ds-danger)_62%,var(--ds-muted))]"
                        : "bg-[color:var(--ds-muted)]"
                  }
                  aria-hidden="true"
                />
                <div className="min-w-0 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[color:var(--ds-panel-muted)] px-2 py-0.5 text-xs font-semibold text-[color:var(--ds-muted)]">
                      {item.lifecycle === "OPEN" ? "Open" : "Recovered"}
                    </span>
                    <span className="rounded-full border border-[color:var(--ds-line-strong)] px-2 py-0.5 text-xs font-semibold text-[color:var(--ds-ink)]">
                      {severityLabel[item.severity]}
                    </span>
                    <span className="text-sm text-[color:var(--ds-muted)]">
                      {item.verdict === "SUPPORTED_ROUTE_FAILURE"
                        ? "Supported route failed"
                        : "Possible stale or broken route"}
                    </span>
                  </div>
                  <div className="mt-3 flex min-w-0 items-center gap-2">
                    <code className="min-w-0 break-all text-sm font-semibold text-[color:var(--ds-ink)]">
                      {item.path}
                    </code>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-[color:var(--ds-muted)] hover:text-[color:var(--ds-ink)]"
                        aria-label={`Open ${item.path} on the Watch site`}
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm text-[color:var(--ds-muted)]">
                    {countLabel(item)} · {item.activeUsers.toLocaleString()}{" "}
                    active users · last seen {formatDate(item.lastSeenAt)} UTC
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--ds-muted)]">
                    HTTP {item.httpStatus ?? "inconclusive"} · manifest{" "}
                    {item.manifestVersion.slice(0, 12)} ·{" "}
                    {item.sources
                      .map((source) =>
                        source === "EXPLICIT_EVENT" ? "event" : "title",
                      )
                      .join(" + ")}
                  </p>
                </div>
                <div className="border-t border-[color:var(--ds-line)] p-5 text-sm text-[color:var(--ds-muted)] md:border-l md:border-t-0 md:text-right">
                  <p>{item.occurrenceCount.toLocaleString()} observations</p>
                  <p className="mt-1">
                    First seen {formatDate(item.firstSeenAt)} UTC
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {page.hasNextPage && page.nextCursor ? (
        <nav className="mt-5 flex justify-end gap-2" aria-label="Alert pages">
          <Link
            className="rounded-[var(--ds-radius)] border border-[color:var(--ds-black)] bg-[color:var(--ds-black)] px-4 py-2 text-sm font-semibold text-[color:var(--ds-panel)]"
            href={`/dashboard/alerts?cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            Next
          </Link>
        </nav>
      ) : null}
    </section>
  )
}
