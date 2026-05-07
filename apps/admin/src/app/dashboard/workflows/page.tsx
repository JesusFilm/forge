import Link from "next/link"
import type { Route } from "next"
import { ArrowUpRight, Clock3, GitBranch, Server, Workflow } from "lucide-react"
import { DashboardPageHeader, StatusPill, cx } from "@/components/admin-ui"
import { requireSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import { loadWorkflowRuntimeRuns } from "@/services/workflow-runtime.service"
import { loadWorkflowWorkerStatusRows } from "@/services/workflow-worker-heartbeat.service"

type WorkflowsPageProps = {
  searchParams?: Promise<{
    status?: string | string[]
    limit?: string | string[]
  }>
}

type StatusFilter = "all" | "active" | "failed" | "completed" | "cancelled"

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "failed", label: "Failed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

function statusToneForWorkflowStatus(
  status: string,
): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "completed" || status === "succeeded") return "success"
  if (status === "failed") return "danger"
  if (status === "cancelled" || status === "skipped") return "warning"
  if (status === "running") return "info"
  return "muted"
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)
}

function formatNullableDateTime(value: Date | null | undefined) {
  return value ? formatDateTime(value) : "Pending"
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseStatusFilter(value: string | string[] | undefined): StatusFilter {
  const status = firstParam(value)
  return STATUS_FILTERS.some((filter) => filter.value === status)
    ? (status as StatusFilter)
    : "all"
}

function parseLimit(value: string | string[] | undefined) {
  const parsed = Number(firstParam(value))
  if (!Number.isFinite(parsed)) return 25

  return Math.min(Math.max(Math.trunc(parsed), 10), 100)
}

function matchesStatusFilter(status: string, filter: StatusFilter) {
  if (filter === "all") return true
  if (filter === "active") {
    return status === "running" || status === "queued" || status === "pending"
  }
  if (filter === "completed") {
    return status === "completed" || status === "succeeded"
  }
  return status === filter
}

function workflowFilterHref(status: StatusFilter, limit: number) {
  const params = new URLSearchParams()
  if (status !== "all") params.set("status", status)
  if (limit !== 25) params.set("limit", limit.toString())
  const query = params.toString()
  return query ? `/dashboard/workflows?${query}` : "/dashboard/workflows"
}

export default async function WorkflowsPage({
  searchParams,
}: WorkflowsPageProps = {}) {
  const messages = await getAdminMessages()
  const page = messages.pages.workflows
  const resolvedSearchParams = await searchParams
  const statusFilter = parseStatusFilter(resolvedSearchParams?.status)
  const limit = parseLimit(resolvedSearchParams?.limit)
  await requireSession()
  const [runs, workers] = await Promise.all([
    loadWorkflowRuntimeRuns(limit),
    loadWorkflowWorkerStatusRows(),
  ])
  const filteredRuns = runs.filter((run) =>
    matchesStatusFilter(run.status, statusFilter),
  )
  const activeRuns = runs.filter((run) => run.status === "running").length
  const failedRuns = runs.filter((run) => run.status === "failed").length
  const eventCount = runs.reduce((total, run) => total + run.eventCount, 0)
  const nextLimit = Math.min(limit + 25, 100)

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
      />

      <section className="grid gap-3 md:grid-cols-3">
        {[
          {
            label: "Runs",
            value: runs.length.toString(),
            detail: limit === 25 ? "latest runtime records" : `latest ${limit}`,
            icon: Workflow,
          },
          {
            label: "Active",
            value: activeRuns.toString(),
            detail: `${failedRuns} failed in view`,
            icon: Clock3,
          },
          {
            label: "Events",
            value: eventCount.toString(),
            detail: "loaded for this index",
            icon: GitBranch,
          },
        ].map((item) => {
          const Icon = item.icon

          return (
            <div
              key={item.label}
              className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="label-text">{item.label}</span>
                <Icon
                  className="h-4 w-4 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              </div>
              <div className="font-mono text-[18px] font-medium">
                {item.value}
              </div>
              <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
                {item.detail}
              </div>
            </div>
          )
        })}
      </section>

      <section aria-labelledby="workflow-runs-heading">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2
              id="workflow-runs-heading"
              className="text-[14px] font-semibold"
            >
              Workflow Runs
            </h2>
            <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
              Open a run to inspect it in the embedded workflow viewer.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1">
              {STATUS_FILTERS.map((filter) => (
                <Link
                  key={filter.value}
                  href={workflowFilterHref(filter.value, limit) as Route}
                  className={cx(
                    "rounded-[2px] px-2 py-1 text-[11px] font-medium transition-colors duration-[120ms]",
                    filter.value === statusFilter
                      ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                  )}
                >
                  {filter.label}
                </Link>
              ))}
            </div>
            <Link
              href={workflowFilterHref(statusFilter, nextLimit) as Route}
              className={cx(
                "inline-flex h-8 items-center rounded-sm border border-[var(--color-hairline)] px-3 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors duration-[120ms]",
                limit >= 100
                  ? "pointer-events-none opacity-45"
                  : "hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
              )}
              aria-disabled={limit >= 100}
            >
              Older
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          {filteredRuns.length > 0 ? (
            <div>
              <div className="hidden min-h-9 grid-cols-[minmax(0,1.4fr)_112px_116px_116px_56px] items-center border-b border-[var(--color-hairline-strong)] px-4 md:grid">
                <div className="label-text">Workflow</div>
                <div className="label-text">Status</div>
                <div className="label-text">Activity</div>
                <div className="label-text">Completed</div>
                <div aria-hidden="true" />
              </div>
              {filteredRuns.map((run) => (
                <Link
                  key={run.runId}
                  href={`/dashboard/workflows/${encodeURIComponent(run.runId)}`}
                  className={cx(
                    "grid gap-3 border-b border-[var(--color-hairline)] px-4 py-3 transition-colors duration-[120ms] last:border-b-0",
                    "hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]",
                    "md:grid-cols-[minmax(0,1.4fr)_112px_116px_116px_56px] md:items-center",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="truncate text-[13px] font-medium">
                        {run.displayName}
                      </h3>
                    </div>
                    <div className="mono-meta mt-1 truncate text-[var(--color-text-muted)]">
                      {run.runId}
                    </div>
                  </div>
                  <div>
                    <StatusPill tone={statusToneForWorkflowStatus(run.status)}>
                      {run.status}
                    </StatusPill>
                  </div>
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    {run.stepCount} steps / {run.eventCount} events
                  </div>
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    {formatNullableDateTime(run.completedAt)}
                  </div>
                  <div className="flex items-center justify-start md:justify-end">
                    <ArrowUpRight
                      className="h-4 w-4 text-[var(--color-text-disabled)]"
                      strokeWidth={1.5}
                    />
                  </div>
                  {run.error ? (
                    <div className="text-[12px] text-[var(--color-danger)] md:col-span-5">
                      {run.error}
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8">
              <div className="mb-3 flex items-center gap-2">
                <Workflow
                  className="h-4 w-4 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
                <StatusPill tone="muted">Idle</StatusPill>
              </div>
              <p className="max-w-2xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
                {runs.length > 0
                  ? "No runs match the selected filter in the loaded window. Load older runs or switch filters."
                  : "Workflow runs will appear here once scheduled jobs, manual jobs, or background backfills enter the runtime."}
              </p>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="workflow-workers-heading">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2
              id="workflow-workers-heading"
              className="text-[14px] font-semibold"
            >
              Workers
            </h2>
            <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
              Recent worker heartbeat and locked-job state.
            </div>
          </div>
          <Server
            className="h-4 w-4 text-[var(--color-text-muted)]"
            strokeWidth={1.5}
          />
        </div>

        <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          {workers.map((worker) => (
            <div
              key={worker.id}
              className="grid gap-3 border-b border-[var(--color-hairline)] px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">
                  {worker.id}
                </div>
                <div className="mono-meta mt-1 truncate text-[var(--color-text-muted)]">
                  {worker.meta}
                </div>
                <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                  {worker.detail}
                </p>
              </div>
              <StatusPill tone={worker.statusTone}>
                {worker.statusLabel}
              </StatusPill>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
