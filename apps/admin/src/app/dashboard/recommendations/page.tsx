import type { Route } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  DashboardPageHeader,
  MetricCard,
  PageSection,
  StatusPill,
  cx,
} from "@/components/admin-ui"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import {
  RECOMMENDATION_TRACE_PAGE_SIZE,
  loadRecommendationOverview,
  loadRecommendationTracePage,
  type RecommendationOverviewData,
  type RecommendationTraceFilters,
  type RecommendationTracePageData,
} from "@/services/recommendations/admin-ops"
import {
  displayRecommendationToken,
  formatRecommendationCount as formatCount,
  formatRecommendationDateTime,
  formatRecommendationPercent as formatPercent,
  recommendationNumberFrom as numberFrom,
} from "./recommendation-display"
import {
  ExperimentEvaluation,
  ProfileShadowEvaluation,
  PromotionDecision,
} from "./recommendation-evaluation-sections"

type RecommendationsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const WINDOW_OPTIONS = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "29d", label: "29 days" },
] as const

const healthCopy = {
  healthy: {
    label: "Healthy",
    description: "Durable evidence is current for this selected window.",
    tone: "success",
  },
  zero_activity: {
    label: "Zero activity",
    description:
      "No request roots exist in this healthy window; this is a measured zero, not missing data.",
    tone: "muted",
  },
  unavailable_unknown: {
    label: "Unavailable — activity unknown",
    description:
      "The current probe or a durable success watermark is unavailable. Counts are intentionally withheld.",
    tone: "danger",
  },
  loss_suspected: {
    label: "Loss suspected",
    description:
      "Committed rejections or write failures exist in this selected window.",
    tone: "danger",
  },
  replay: {
    label: "Replay observed",
    description: "Idempotent duplicate evidence was received in this window.",
    tone: "warning",
  },
  conflict: {
    label: "Conflict observed",
    description: "An evidence identity arrived with a different digest.",
    tone: "danger",
  },
  late: {
    label: "Late evidence",
    description: "Accepted terminal evidence arrived after its active horizon.",
    tone: "warning",
  },
  classifier_lag: {
    label: "Classifier lag",
    description: "An episode is past its deadline without an outcome.",
    tone: "warning",
  },
  retention_overdue: {
    label: "Retention overdue",
    description: "Raw request roots are beyond their deletion propagation SLA.",
    tone: "danger",
  },
} as const

export default async function RecommendationsPage({
  searchParams,
}: RecommendationsPageProps = {}) {
  const principal = await requireSession()
  if (!hasPermission(principal, "read:recommendation-aggregates")) {
    redirect("/dashboard")
  }
  const params = (await searchParams) ?? {}
  const canReadTraces = hasPermission(principal, "read:recommendation-traces")
  const canOperatePromotion = hasPermission(
    principal,
    "operate:recommendation-experiments",
  )
  const [overview, traces] = await Promise.all([
    loadRecommendationOverview(prisma, {
      window: params.window,
    }),
    canReadTraces
      ? loadRecommendationTracePage(prisma, {
          window: params.window,
          requestState: params.state,
          fallbackReason: params.fallback,
          evidenceState: params.evidence,
          cursor: params.cursor,
        })
      : null,
  ])

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Recommendation operations"
        title="Recommendations"
        description="Window-scoped semantic delivery, evidence, classifier, and retention truth."
        action={<WindowPicker selected={overview.window.preset} />}
      />

      <HealthSummary overview={overview} />
      <PromotionDecision overview={overview} canOperate={canOperatePromotion} />
      <ControlReadiness overview={overview} canReadTraces={canReadTraces} />
      <ExperimentEvaluation overview={overview} />
      <ProfileShadowEvaluation overview={overview} />
      <Funnel overview={overview} />
      <OperationalTruth overview={overview} />
      <EligibilityTruth overview={overview} />
      <PrivacyTruth overview={overview} />
      {traces ? (
        <TraceSection traces={traces} />
      ) : (
        <PageSection title="Request traces" meta="ADMIN-ONLY / PRIVACY-SAFE">
          <p className="px-4 py-5 text-[13px] text-[var(--color-text-muted)]">
            Request traces require Admin access. Aggregate health above contains
            no request identifiers, links, cursors, or trace-list results.
          </p>
        </PageSection>
      )}
    </div>
  )
}

function ControlReadiness({
  overview,
  canReadTraces,
}: {
  overview: RecommendationOverviewData
  canReadTraces: boolean
}) {
  const readiness = overview.controlReadiness
  if (!readiness) {
    return (
      <PageSection
        title="Semantic control readiness"
        meta="OFFLINE / AGGREGATE ONLY"
      >
        <p className="px-4 py-5 text-[13px] text-[var(--color-text-muted)]">
          No retained semantic-control evaluation is available. Delivery still
          uses the configured semantic fallback and the existing serving
          deadline.
        </p>
      </PageSection>
    )
  }
  const stateTone =
    readiness.state === "ready"
      ? "success"
      : readiness.state === "data-unhealthy" || readiness.state === "not-ready"
        ? "danger"
        : "warning"
  const dimensions = Object.entries(readiness.dimensions) as Array<
    [string, "pass" | "fail" | "inconclusive" | "unhealthy"]
  >
  const issued = numberFrom(readiness.evidence, "issuedRequests")
  const mature = numberFrom(readiness.evidence, "matureOutcomes")
  const machineExcluded = numberFrom(readiness.evidence, "machineExcluded")
  const ctr = numberFrom(readiness.rates, "ctr")
  const qualified = numberFrom(readiness.rates, "qualifiedOutcome")
  const qualifiedInterval = nestedInterval(
    readiness.uncertainty,
    "qualifiedOutcome",
  )
  return (
    <PageSection
      title="Semantic control readiness"
      meta={`REVISION ${readiness.revision} / OFFLINE / AGGREGATE ONLY`}
    >
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={stateTone}>
              {displayRecommendationToken(readiness.state)}
            </StatusPill>
            <span className="font-mono text-[10px] text-[var(--color-text-muted)] uppercase">
              Evaluated {formatRecommendationDateTime(readiness.evaluatedAt)}
            </span>
          </div>
          <p className="mt-3 max-w-4xl text-[13px] text-[var(--color-text-secondary)]">
            {readiness.explanation}
          </p>
          <div
            className="mt-3 flex flex-wrap gap-2"
            aria-label="Readiness dimensions"
          >
            {dimensions.map(([label, state]) => (
              <StatusPill
                key={label}
                tone={
                  state === "pass"
                    ? "success"
                    : state === "fail" || state === "unhealthy"
                      ? "danger"
                      : "warning"
                }
              >
                {displayRecommendationToken(label)} ·{" "}
                {displayRecommendationToken(state)}
              </StatusPill>
            ))}
          </div>
        </div>
        {canReadTraces ? (
          <Link
            href="/dashboard/recommendations?window=7d"
            className="rounded-sm border border-[var(--color-hairline)] px-3 py-2 font-mono text-[11px] uppercase hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            Inspect request traces
          </Link>
        ) : null}
      </div>
      <div className="grid gap-px border-t border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-5">
        <Definition
          label="Eligible request cohort"
          value={`${formatCount(issued ?? undefined)} issued human requests`}
        />
        <Definition
          label="Mature outcomes"
          value={formatCount(mature ?? undefined)}
        />
        <Definition label="CTR (operational)" value={formatPercent(ctr)} />
        <Definition
          label="Qualified outcome"
          value={formatPercent(qualified)}
        />
        <Definition
          label="Qualified 95% interval"
          value={
            qualifiedInterval
              ? `${formatPercent(qualifiedInterval.lower)}–${formatPercent(qualifiedInterval.upper)}`
              : "Unknown"
          }
        />
      </div>
      <div className="grid gap-4 border-t border-[var(--color-hairline)] p-4 lg:grid-cols-3">
        <div>
          <div className="label-text">Exact input window</div>
          <p className="mt-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
            {formatRecommendationDateTime(readiness.window.start)} →{" "}
            {formatRecommendationDateTime(readiness.window.end)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            Captured{" "}
            {formatRecommendationDateTime(readiness.window.inputCapturedAt)}
            {" · "}Machine excluded: {formatCount(machineExcluded ?? undefined)}
          </p>
        </div>
        <div>
          <div className="label-text">Evidence watermarks</div>
          <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
            Request {formatRecommendationDateTime(readiness.watermarks.request)}
            {" · "}impression{" "}
            {formatRecommendationDateTime(readiness.watermarks.impression)}
            {" · "}selection{" "}
            {formatRecommendationDateTime(readiness.watermarks.selection)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            Outcome {formatRecommendationDateTime(readiness.watermarks.outcome)}
            {" · "}mission{" "}
            {formatRecommendationDateTime(readiness.watermarks.mission)}
            {" · "}eligibility{" "}
            {formatRecommendationDateTime(readiness.watermarks.eligibility)}
          </p>
        </div>
        <div>
          <div className="label-text">Pinned versions and lifecycle</div>
          <p className="mt-2 break-words font-mono text-[11px] text-[var(--color-text-secondary)]">
            {readiness.strategyVersion} · {readiness.policyVersion} ·{" "}
            {readiness.outcomePolicyVersion} · {readiness.classifierVersion} ·{" "}
            {readiness.integrityPolicyVersion}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            {displayRecommendationToken(readiness.identityClass)} ·{" "}
            {readiness.retentionDays} days ·{" "}
            {displayRecommendationToken(readiness.deletionBehavior)} ·{" "}
            {displayRecommendationToken(readiness.fallbackBehavior)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
            Input {readiness.inputDigest.slice(0, 12)} · manifest{" "}
            {readiness.manifestDigest.slice(0, 12)}
          </p>
        </div>
      </div>
    </PageSection>
  )
}

function WindowPicker({ selected }: { selected: "24h" | "7d" | "29d" }) {
  return (
    <nav
      aria-label="Recommendation evidence window"
      className="inline-flex rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1"
    >
      {WINDOW_OPTIONS.map((option) => (
        <Link
          key={option.value}
          href={`/dashboard/recommendations?window=${option.value}` as Route}
          aria-current={selected === option.value ? "page" : undefined}
          className={cx(
            "rounded-sm px-3 py-1.5 font-mono text-[11px] uppercase transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
            selected === option.value
              ? "bg-[var(--color-brand)] text-white"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
          )}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  )
}

function HealthSummary({ overview }: { overview: RecommendationOverviewData }) {
  const primary = healthCopy[overview.health.primary]
  return (
    <section
      aria-labelledby="recommendation-health-heading"
      className="app-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label-text">Selected-window truth</div>
          <h2
            id="recommendation-health-heading"
            className="mt-1 text-lg font-medium"
          >
            {primary.label}
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--color-text-muted)]">
            {primary.description}
          </p>
        </div>
        <StatusPill tone={primary.tone}>{primary.label}</StatusPill>
      </div>
      {overview.health.states.length > 1 ? (
        <div
          className="mt-3 flex flex-wrap gap-2"
          aria-label="Additional health states"
        >
          {overview.health.states.slice(1).map((state) => (
            <StatusPill key={state} tone={healthCopy[state].tone}>
              {healthCopy[state].label}
            </StatusPill>
          ))}
        </div>
      ) : null}
      <div className="mt-4 border-t border-[var(--color-hairline)] pt-3 font-mono text-[10px] text-[var(--color-text-muted)] uppercase">
        {formatDate(overview.window.start)} to {formatDate(overview.window.end)}{" "}
        UTC
      </div>
    </section>
  )
}

function Funnel({ overview }: { overview: RecommendationOverviewData }) {
  const counts = overview.counts
  const cards = [
    ["Prepared", counts?.preparedRequests],
    ["Issued", counts?.issuedRequests],
    ["Issuance failed", counts?.issuanceFailedRequests],
    ["Served items", counts?.servedItems],
    ["Rendered", counts?.renderedItems],
    ["Impressions", counts?.impressions],
    ["Selections", counts?.selections],
    ["Playback starts", counts?.playbackStarts],
    ["Finalized", counts?.finalizedEpisodes],
    ["Fallback requests", counts?.fallbackRequests],
  ] as const
  return (
    <section aria-labelledby="recommendation-funnel-heading">
      <h2 id="recommendation-funnel-heading" className="sr-only">
        Recommendation funnel counts
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map(([label, value]) => (
          <MetricCard
            key={label}
            label={label}
            value={formatCount(value)}
            footer={overview.window.preset}
          />
        ))}
      </div>
    </section>
  )
}

function OperationalTruth({
  overview,
}: {
  overview: RecommendationOverviewData
}) {
  const counts = overview.counts
  const rows = [
    ["Loss suspected", formatCount(counts?.lossSuspected)],
    ["Committed rejections", formatCount(counts?.committedRejections)],
    ["Write failures", formatCount(counts?.writeFailures)],
    ["Replay", formatCount(counts?.replays)],
    ["Conflict", formatCount(counts?.conflicts)],
    ["Late evidence", formatCount(counts?.late)],
    ["Classifier lag", formatCount(counts?.classifierLag)],
    [
      "Selection without impression",
      formatCount(counts?.selectionWithoutImpression),
    ],
    ["Retrieval p50", formatMs(overview.latency?.p50Ms)],
    ["Retrieval p95", formatMs(overview.latency?.p95Ms)],
    [
      "Delivery watermark",
      formatRecommendationDateTime(overview.watermarks?.deliverySuccessAt),
    ],
    [
      "Evidence watermark",
      formatRecommendationDateTime(overview.watermarks?.evidenceSuccessAt),
    ],
    [
      "Database probe",
      formatRecommendationDateTime(overview.watermarks?.databaseProbeAt),
    ],
    ["Oldest pending", formatRecommendationDateTime(overview.oldestPendingAt)],
    [
      "Last purge",
      formatRecommendationDateTime(overview.retention?.latestSuccessAt),
    ],
    ["Retention", displayRecommendationToken(overview.retention?.reason)],
  ] as const
  return (
    <PageSection
      title="Evidence and retention"
      meta="SCOPED COUNTS / WATERMARKS"
    >
      <div className="grid gap-px bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="bg-[var(--color-surface)] px-4 py-3">
            <div className="label-text">{label}</div>
            <div className="mt-1 break-words font-mono text-[12px] text-[var(--color-text-secondary)]">
              {value}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--color-hairline)] px-4 py-4 text-[13px] text-[var(--color-text-muted)]">
        <span className="font-medium text-[var(--color-text-primary)]">
          Effective manifest:
        </span>{" "}
        {overview.serving
          ? `${overview.serving.manifest.strategyVersion} · ${overview.serving.manifest.surfaceVersion} · ${overview.serving.enabled ? "enabled" : "disabled"} (${overview.serving.reasonCode})`
          : "Unknown while the recommendation data plane is unavailable."}
      </div>
    </PageSection>
  )
}

function EligibilityTruth({
  overview,
}: {
  overview: RecommendationOverviewData
}) {
  const integrity = overview.eligibility
  const rows = [
    ["Pending explicit classification", formatCount(integrity?.pending)],
    ["Eligible", formatCount(integrity?.eligible)],
    ["Excluded", formatCount(integrity?.excluded)],
    ["Quarantined", formatCount(integrity?.quarantined)],
  ] as const
  return (
    <PageSection
      title="Learning eligibility"
      meta="EXPLICIT POLICY / CURRENT PROJECTION"
    >
      <div className="grid gap-px bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="bg-[var(--color-surface)] px-4 py-3">
            <div className="label-text">{label}</div>
            <div className="mt-1 font-mono text-[12px] text-[var(--color-text-secondary)]">
              {value}
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 border-t border-[var(--color-hairline)] px-4 py-4 lg:grid-cols-2">
        <div>
          <div className="label-text">Accepted sources by actor</div>
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
            Human anonymous{" "}
            {formatCount(integrity?.actorClasses.humanAnonymous)}
            {" · "}signed in{" "}
            {formatCount(integrity?.actorClasses.humanSignedIn)}
            {" · "}machine {formatCount(integrity?.actorClasses.machine)}
            {" · "}internal {formatCount(integrity?.actorClasses.internal)}
            {" · "}test {formatCount(integrity?.actorClasses.test)}
          </p>
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
            Projection contamination: {formatCount(integrity?.contamination)}
          </p>
        </div>
        <div>
          <div className="label-text">Current reason codes</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {integrity?.reasonCodes.map((reason) => (
              <StatusPill key={reason.reasonCode} tone="warning">
                {displayRecommendationToken(reason.reasonCode)} · {reason.count}
              </StatusPill>
            ))}
            {integrity?.reasonCodes.length === 0 ? (
              <span className="text-[13px] text-[var(--color-text-muted)]">
                No exclusion or quarantine reasons in this window.
              </span>
            ) : null}
            {!integrity ? (
              <span className="text-[13px] text-[var(--color-text-muted)]">
                Eligibility state is unavailable with the current data-plane
                probe.
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </PageSection>
  )
}

function PrivacyTruth({ overview }: { overview: RecommendationOverviewData }) {
  const privacy = overview.privacy
  const latest = privacy?.latestTransition
  return (
    <PageSection
      title="Privacy and continuity"
      meta="CONSENTED PROFILES / NON-LINKABLE OPERATIONS"
    >
      <div className="grid gap-px bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-4">
        <Definition
          label="Active durable profiles"
          value={formatCount(privacy?.profiles.active)}
        />
        <Definition
          label="Tombstoned / expired"
          value={
            privacy
              ? `${privacy.profiles.tombstoned} / ${privacy.profiles.expired}`
              : "Unknown"
          }
        />
        <Definition
          label="Pending / failed erasure"
          value={
            privacy
              ? `${privacy.profiles.pendingErasure} / ${privacy.profiles.failedErasure}`
              : "Unknown"
          }
        />
        <Definition
          label="Stale workers fenced"
          value={formatCount(privacy?.staleWorkerRejections)}
        />
      </div>
      <div className="grid gap-4 border-t border-[var(--color-hairline)] p-4 text-[12px] md:grid-cols-2">
        <div>
          <div className="label-text">Selected-window choices</div>
          <p className="mt-2 text-[var(--color-text-secondary)]">
            grant {formatCount(privacy?.transitions.grant)} · reset{" "}
            {formatCount(privacy?.transitions.reset)} · withdraw{" "}
            {formatCount(privacy?.transitions.withdraw)} · delete{" "}
            {formatCount(privacy?.transitions.delete)} · expire{" "}
            {formatCount(privacy?.transitions.expire)}
          </p>
        </div>
        <div>
          <div className="label-text">Latest safe evidence</div>
          <p className="mt-2 text-[var(--color-text-secondary)]">
            {latest
              ? `${displayRecommendationToken(latest.kind)} · generation ${latest.fromGeneration ?? "none"} → ${latest.toGeneration ?? "none"} · ${displayRecommendationToken(latest.erasureState)} · ${formatRecommendationDateTime(latest.occurredAt)}`
              : "No profile transition in this window."}
          </p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            Last deletion drill{" "}
            {formatRecommendationDateTime(privacy?.lastDeletionDrillAt)}. Raw
            cookies, digests, session links, and viewer histories are never
            exposed here.
          </p>
        </div>
      </div>
    </PageSection>
  )
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <div className="label-text">{label}</div>
      <div className="mt-1 font-mono text-[12px] text-[var(--color-text-secondary)]">
        {value}
      </div>
    </div>
  )
}

function TraceSection({ traces }: { traces: RecommendationTracePageData }) {
  return (
    <PageSection
      title="Request traces"
      meta={`ADMIN / ACTIVE ROOTS / ${RECOMMENDATION_TRACE_PAGE_SIZE} PER PAGE`}
    >
      <TraceFilters window={traces.window.preset} filters={traces.filters} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-y border-[var(--color-hairline)] text-[var(--color-text-muted)]">
              <th scope="col" className="px-4 py-2 font-medium">
                Request
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Lifecycle
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Funnel
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Strategy
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {traces.rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--color-hairline)] align-top"
              >
                <td className="px-4 py-3">
                  <Link
                    href={
                      `/dashboard/recommendations/${encodeURIComponent(row.id)}?window=${traces.window.preset}` as Route
                    }
                    className="break-all font-mono text-[var(--color-info)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                  >
                    {row.id}
                  </Link>
                  <div className="mt-1 text-[var(--color-text-muted)]">
                    {row.locale}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusPill
                    tone={
                      row.state === "issuance_failed"
                        ? "danger"
                        : row.state === "issued"
                          ? "success"
                          : "warning"
                    }
                  >
                    {displayRecommendationToken(row.state)}
                  </StatusPill>
                  <div className="mt-2 text-[var(--color-text-muted)]">
                    {displayRecommendationToken(row.result)} ·{" "}
                    {displayRecommendationToken(row.fallbackReason)}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
                  {row.counts.items}/{row.expectedItemCount} served ·{" "}
                  {row.counts.rendered} rendered · {row.counts.impressions} seen
                  · {row.counts.selections} selected · {row.counts.episodes}{" "}
                  episodes · {row.counts.outcomes} outcomes ·{" "}
                  {row.counts.conflicts} conflicts
                </td>
                <td className="px-4 py-3">
                  <div>{row.strategyVersion}</div>
                  <div className="mt-1 text-[var(--color-text-muted)]">
                    {row.classifierVersion}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                    {formatMs(row.retrievalLatencyMs)} ·{" "}
                    {row.responseBytes == null
                      ? "Unknown bytes"
                      : `${row.responseBytes.toLocaleString("en-US")} bytes`}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-text-muted)]">
                  {formatRecommendationDateTime(row.createdAt)}
                  <div className="mt-1">
                    Issued {formatRecommendationDateTime(row.issuedAt)}
                  </div>
                </td>
              </tr>
            ))}
            {traces.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                >
                  No active request roots match these bounded filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {traces.nextCursor ? (
        <div className="flex justify-end border-t border-[var(--color-hairline)] px-4 py-3">
          <Link
            href={tracePageHref(traces, traces.nextCursor) as Route}
            className="rounded-sm border border-[var(--color-hairline)] px-3 py-1.5 font-mono text-[11px] uppercase hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            Next {RECOMMENDATION_TRACE_PAGE_SIZE}
          </Link>
        </div>
      ) : null}
    </PageSection>
  )
}

function TraceFilters({
  window,
  filters,
}: {
  window: "24h" | "7d" | "29d"
  filters: RecommendationTraceFilters
}) {
  return (
    <form method="get" className="grid gap-3 px-4 py-4 md:grid-cols-4">
      <input type="hidden" name="window" value={window} />
      <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
        Lifecycle state
        <select
          name="state"
          defaultValue={filters.requestState ?? ""}
          className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)]"
        >
          <option value="">All</option>
          <option value="prepared">Prepared</option>
          <option value="issued">Issued</option>
          <option value="issuance_failed">Issuance failed</option>
        </select>
      </label>
      <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
        Evidence state
        <select
          name="evidence"
          defaultValue={filters.evidenceState ?? ""}
          className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)]"
        >
          <option value="">All</option>
          <option value="loss_suspected">Loss suspected</option>
          <option value="replay">Replay</option>
          <option value="conflict">Conflict</option>
          <option value="late">Late</option>
          <option value="classifier_lag">Classifier lag</option>
        </select>
      </label>
      <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
        Fallback reason
        <input
          name="fallback"
          defaultValue={filters.fallbackReason ?? ""}
          maxLength={64}
          pattern="[a-z0-9][a-z0-9_-]{0,63}"
          className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)]"
        />
      </label>
      <button
        type="submit"
        className="mt-auto h-9 rounded-sm bg-[var(--color-brand)] px-3 text-[12px] font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      >
        Apply filters
      </button>
    </form>
  )
}

function tracePageHref(data: RecommendationTracePageData, cursor: string) {
  const query = new URLSearchParams({
    window: data.window.preset,
    cursor,
  })
  if (data.filters.requestState) query.set("state", data.filters.requestState)
  if (data.filters.fallbackReason)
    query.set("fallback", data.filters.fallbackReason)
  if (data.filters.evidenceState)
    query.set("evidence", data.filters.evidenceState)
  return `/dashboard/recommendations?${query.toString()}`
}

function formatMs(value: number | null | undefined) {
  return value == null ? "Unknown" : `${Math.round(value)} ms`
}

function nestedInterval(
  value: Readonly<Record<string, unknown>>,
  key: string,
): { lower: number; upper: number } | null {
  const entry = value[key]
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
  const { lower, upper } = entry as Record<string, unknown>
  return typeof lower === "number" && typeof upper === "number"
    ? { lower, upper }
    : null
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10)
}
