import Link from "next/link"
import type { Route } from "next"
import { ArrowLeft, CircleDashed, Database, SearchCheck } from "lucide-react"
import type { SeoRunDetail } from "./seo-contract"
import { formatSeoDate } from "./seo-presenter"

function text(value: unknown, fallback = "Not recorded"): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return fallback
}

function integer(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "—"
}

function retentionMessage(availability: SeoRunDetail["reportAvailability"]) {
  return {
    running: "This job is still running; detailed evidence is not final yet.",
    available: null,
    legacy_unavailable:
      "This run predates the versioned audit report. Scalar run totals remain available.",
    malformed:
      "The retained report failed validation, so provider-produced detail is hidden.",
    unsupported_version:
      "This report was written by a newer schema version and is hidden until this Manager version understands it.",
    detail_expired:
      "Query and request detail expired after 29 days. Safe totals and proposal links remain.",
    detail_suppressed_retention_unhealthy:
      "Detailed evidence was not retained because production retention health was not proven at completion.",
  }[availability]
}

export function SeoRunDetailView({
  run,
  returnHref,
}: {
  run: SeoRunDetail
  returnHref: string
}) {
  const availableReport =
    run.report?.__typename === "ManagerSeoRunReportAvailable"
      ? run.report
      : null
  const requests = availableReport?.gscRequests ?? []
  const decisions = availableReport?.queryDecisions ?? []
  const funnel = availableReport?.queryFunnel
  const outcomeByReference = new Map(
    run.proposalOutcomes.map((outcome) => [
      `${outcome.proposalId}:${outcome.payloadDigest}`,
      outcome,
    ]),
  )
  const proposalReferences = (run.report?.proposalRefs ?? []).map(
    (reference) => ({
      reference,
      outcome: outcomeByReference.get(
        `${reference.proposalId}:${reference.payloadDigest}`,
      ),
    }),
  )
  const message = retentionMessage(run.reportAvailability)

  return (
    <section className="seo-workspace seo-run-detail-page">
      <Link className="seo-run-back" href={returnHref as Route}>
        <ArrowLeft aria-hidden="true" size={17} /> Back to run log
      </Link>

      <header className="seo-detail-hero">
        <div className="seo-detail-hero-topline">
          <span className="seo-status-badge">{run.mode.toLowerCase()}</span>
          <span className="seo-status-badge">{run.status.toLowerCase()}</span>
          <span className="seo-status-badge">
            {run.reportAvailability.replaceAll("_", " ")}
          </span>
          {run.reclaimed ? (
            <span className="seo-status-badge is-warning">reclaimed</span>
          ) : null}
        </div>
        <h1 id="seo-run-detail-title">SEO run</h1>
        <p className="seo-canonical">{run.id}</p>
        <dl className="seo-detail-summary-grid">
          <div>
            <dt>Started</dt>
            <dd>{formatSeoDate(run.startedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>
              {run.completedAt ? formatSeoDate(run.completedAt) : "In progress"}
            </dd>
          </div>
          <div>
            <dt>Eligible targets</dt>
            <dd>{run.eligibleCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Selected targets</dt>
            <dd>{run.selectedCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Proposal candidates</dt>
            <dd>{run.wouldProposeCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>New proposal versions</dt>
            <dd>{run.proposedCount.toLocaleString()}</dd>
          </div>
        </dl>
      </header>

      {message ? (
        <div className="seo-inline-warning" role="status">
          <CircleDashed aria-hidden="true" size={20} />
          <div>
            <strong>Detailed evidence unavailable</strong>
            <p>{message}</p>
          </div>
        </div>
      ) : null}

      {requests.length > 0 ? (
        <section className="seo-detail-section" aria-labelledby="request-scope">
          <div className="seo-section-heading">
            <div>
              <span className="seo-section-eyebrow">Provider inputs</span>
              <h2 id="request-scope">Search Console request scope</h2>
            </div>
            <Database aria-hidden="true" size={22} />
          </div>
          <div className="seo-run-request-grid">
            {requests.map((request, index) => (
              <dl key={`${text(request.propertyId)}-${index}`}>
                <div>
                  <dt>Property</dt>
                  <dd>{text(request.propertyId)}</dd>
                </div>
                <div>
                  <dt>Window</dt>
                  <dd>
                    {text(request.startDate)} – {text(request.endDate)}
                  </dd>
                </div>
                <div>
                  <dt>Dimensions</dt>
                  <dd>
                    {Array.isArray(request.dimensions)
                      ? request.dimensions.join(", ")
                      : "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Rows / cap</dt>
                  <dd>
                    {integer(request.returnedRowCount)} /{" "}
                    {integer(request.configuredRowCap)}
                    {request.capReached === true ? " · cap reached" : ""}
                  </dd>
                </div>
                <div>
                  <dt>Data state</dt>
                  <dd>{text(request.dataState)}</dd>
                </div>
                <div>
                  <dt>Filters</dt>
                  <dd>
                    {request.filters.length > 0
                      ? request.filters
                          .map(
                            (filter) =>
                              `${filter.dimension} ${filter.operator} ${filter.expression}`,
                          )
                          .join(" · ")
                      : "None"}
                    {request.omittedFilterCount > 0
                      ? ` · ${request.omittedFilterCount} omitted`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{text(request.status)}</dd>
                </div>
                {request.caveats.length > 0 ||
                request.omittedCaveatCount > 0 ? (
                  <div>
                    <dt>Caveats</dt>
                    <dd>
                      {request.caveats.join(" · ") || "None retained"}
                      {request.omittedCaveatCount > 0
                        ? ` · ${request.omittedCaveatCount} omitted`
                        : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ))}
          </div>
          {availableReport?.omittedGscRequestCount ? (
            <p>
              {availableReport.omittedGscRequestCount} additional request
              {availableReport.omittedGscRequestCount === 1
                ? " was"
                : "s were"}{" "}
              omitted by the detail bound.
            </p>
          ) : null}
        </section>
      ) : null}

      {funnel ? (
        <section className="seo-detail-section" aria-labelledby="query-funnel">
          <div className="seo-section-heading">
            <div>
              <span className="seo-section-eyebrow">Selection funnel</span>
              <h2 id="query-funnel">How provider rows were narrowed</h2>
            </div>
            <SearchCheck aria-hidden="true" size={22} />
          </div>
          <dl className="seo-run-funnel">
            {Object.entries(funnel).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt>
                <dd>{integer(value)}</dd>
              </div>
            ))}
          </dl>
          {availableReport?.omittedSkippedTargetCount ? (
            <p>
              {availableReport.omittedSkippedTargetCount} skipped target
              {availableReport.omittedSkippedTargetCount === 1
                ? " was"
                : "s were"}{" "}
              omitted by the detail bound.
            </p>
          ) : null}
        </section>
      ) : null}

      {decisions.length > 0 ? (
        <section
          className="seo-detail-section"
          aria-labelledby="query-decisions"
        >
          <div className="seo-section-heading">
            <div>
              <span className="seo-section-eyebrow">Bounded decision log</span>
              <h2 id="query-decisions">Evaluated query candidates</h2>
              <p>
                {integer(availableReport?.omittedQueryDecisionCount)} additional
                ranked rows omitted by the configured audit bound.
              </p>
            </div>
          </div>
          <div className="seo-run-table-wrap" tabIndex={0}>
            <table className="seo-run-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Locale</th>
                  <th>Query</th>
                  <th>Page</th>
                  <th>Clicks</th>
                  <th>Impressions</th>
                  <th>CTR</th>
                  <th>Position</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((decision, index) => (
                  <tr key={`${text(decision.observationId)}-${index}`}>
                    <td>{text(decision.targetId)}</td>
                    <td>{text(decision.locale)}</td>
                    <td>{text(decision.query)}</td>
                    <td className="seo-canonical">
                      {text(decision.canonicalUrl)}
                    </td>
                    <td>{integer(decision.clicks)}</td>
                    <td>{integer(decision.impressions)}</td>
                    <td>
                      {typeof decision.ctr === "number"
                        ? `${(decision.ctr * 100).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td>{integer(decision.position)}</td>
                    <td>
                      <strong>{text(decision.selectionOutcome)}</strong>
                      <small>{text(decision.reason, "")}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section
        className="seo-detail-section"
        aria-labelledby="proposal-outcomes"
      >
        <div className="seo-section-heading">
          <div>
            <span className="seo-section-eyebrow">Downstream ledger</span>
            <h2 id="proposal-outcomes">Proposal and human outcomes</h2>
          </div>
        </div>
        {proposalReferences.length === 0 ? (
          <div className="seo-empty-state is-compact">
            <strong>No persisted proposal outcomes</strong>
            <p>
              This is expected for dry-runs and jobs that selected no action.
            </p>
          </div>
        ) : (
          <div className="seo-run-outcomes">
            {proposalReferences.map(({ reference, outcome }) => {
              const decision = outcome?.humanDecision
              const experiment = outcome?.experiment
              return (
                <article
                  key={`${reference.proposalId}:${reference.payloadDigest}`}
                >
                  <strong>
                    {reference.proposalId}
                    {reference.version == null
                      ? " · would propose"
                      : ` · v${reference.version}`}
                  </strong>
                  <span>{reference.disposition.replaceAll("_", " ")}</span>
                  <small>
                    Digest: {reference.payloadDigest} · Human decision:{" "}
                    {decision?.action ?? "pending"} · Materialization:{" "}
                    {outcome?.materializationStatus ?? "none"}
                    {experiment ? ` · Experiment: ${experiment.status}` : ""}
                  </small>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </section>
  )
}
