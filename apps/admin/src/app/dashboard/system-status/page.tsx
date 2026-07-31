import { Activity } from "lucide-react"
import Link from "next/link"
import {
  DashboardPageHeader,
  PageSection,
  QueueList,
  SecondaryButton,
  StatusPill,
} from "@/components/admin-ui"
import { loadSystemStatusData } from "@/app/dashboard/ops-data"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import { CoreSyncTriggerButton } from "../workflows/core-sync-trigger-button"

function metricValue(
  metrics: Awaited<ReturnType<typeof loadSystemStatusData>>["metrics"],
  label: string,
) {
  return metrics.find((metric) => metric.label === label)?.value ?? "Unknown"
}

export default async function SystemStatusPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.systemStatus
  const principal = await requireSession()
  const data = await loadSystemStatusData()
  const canTriggerSync = hasPermission(principal, "system:trigger-workflow")
  const lockState = metricValue(data.metrics, "Lock State")
  const latestAttemptedSync = metricValue(data.metrics, "Latest Attempted Sync")

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        action={
          canTriggerSync ? (
            <CoreSyncTriggerButton />
          ) : (
            <SecondaryButton disabled>
              {messages.common.readOnly}
            </SecondaryButton>
          )
        }
      />

      <section aria-labelledby="core-sync-dimensions-title">
        <div className="mb-3 flex items-center gap-2">
          <Activity
            className="h-4 w-4 text-[var(--color-text-muted)]"
            strokeWidth={1.5}
          />
          <h2 id="core-sync-dimensions-title" className="label-text">
            Core Sync health dimensions
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {data.healthAxes.map((axis) => (
            <section
              key={axis.key}
              aria-labelledby={`core-sync-${axis.key}-title`}
              className="app-card p-4"
            >
              <h3
                id={`core-sync-${axis.key}-title`}
                className="mb-2 text-[13px] font-semibold"
              >
                {axis.label}
              </h3>
              <StatusPill tone={axis.statusTone}>{axis.statusLabel}</StatusPill>
              <p className="mt-3 text-[13px] leading-6 text-[var(--color-text-secondary)]">
                {axis.detail}
              </p>
            </section>
          ))}
        </div>
      </section>

      <section className="app-card p-4" aria-label="Core Sync run summary">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["Lock", lockState],
            ["Latest sync", metricValue(data.metrics, "Latest Sync")],
            ["Latest attempted sync", latestAttemptedSync],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-2"
            >
              <div className="label-text mb-1">{label}</div>
              <div className="font-mono text-[13px]">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <PageSection title="Phase Execution State" meta="EXECUTION_ONLY">
          <table className="w-full border-collapse text-left">
            <thead className="hairline-strong-b">
              <tr className="h-10">
                <th className="label-text px-4">Data set</th>
                <th className="label-text px-4">Status</th>
                <th className="label-text px-4">Last run</th>
              </tr>
            </thead>
            <tbody>
              {data.matrix.map((row) => (
                <tr
                  key={`${row.entity}-${row.source}`}
                  className="hairline-b h-12"
                >
                  <td className="px-4 text-[13px] font-medium">{row.entity}</td>
                  <td className="px-4">
                    <StatusPill tone={row.statusTone}>
                      {row.statusLabel}
                    </StatusPill>
                  </td>
                  <td className="px-4 font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {row.lastRun}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PageSection>

        <PageSection title="Needs Attention" meta="CURRENT_RUN">
          <QueueList
            items={data.incidents.map((item) => ({
              title: item.title,
              meta: item.meta,
              detail: item.detail,
              status: { label: item.statusLabel, tone: item.statusTone },
            }))}
          />
        </PageSection>
      </div>

      <PageSection title="Subtitle Parity Evidence" meta="LAST_COMPLETED_CHECK">
        {data.parityEvidence ? (
          <div className="grid gap-5 p-4 lg:grid-cols-2">
            <dl className="grid min-w-0 gap-3 text-[13px]">
              <div className="min-w-0">
                <dt className="label-text mb-1">Completed</dt>
                <dd className="font-mono text-[11px]">
                  <time dateTime={data.parityEvidence.completedAtIso}>
                    {data.parityEvidence.completedAt} UTC
                  </time>
                </dd>
              </div>
              {[
                ["Stable check ID", data.parityEvidence.checkId],
                ["Core snapshot", data.parityEvidence.snapshot],
                ["Core root", data.parityEvidence.coreRootChecksum],
                ["Admin root", data.parityEvidence.adminRootChecksum],
                [
                  "Subtitle records",
                  `Core ${data.parityEvidence.coreTotalCount} / Admin ${data.parityEvidence.adminTotalCount}`,
                ],
                [
                  "Unprojectable Admin rows",
                  data.parityEvidence.unprojectableCount.toString(),
                ],
                [
                  "Latest attempt",
                  `${data.parityEvidence.latestAttemptCheckId} (${data.parityEvidence.latestAttemptStatus})`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="label-text mb-1">{label}</dt>
                  <dd className="break-all font-mono text-[11px]">{value}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="subtitle-parity-residuals-title">
              <h3
                id="subtitle-parity-residuals-title"
                className="text-[13px] font-semibold"
              >
                Residual videos
              </h3>
              <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                Showing {data.parityEvidence.residualSample.length} of{" "}
                {data.parityEvidence.residualTotal} residual videos.
              </p>
              {data.parityEvidence.residualSample.length > 0 ? (
                <ul className="mt-3 grid gap-2">
                  {data.parityEvidence.residualSample.map((residual) => (
                    <li
                      key={residual.videoId}
                      className="rounded-sm border border-[var(--color-hairline)] p-3"
                    >
                      <div className="break-all font-mono text-[11px]">
                        {residual.videoId}
                      </div>
                      <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                        {residual.reason ??
                          "Reason is not present in the bounded diagnostic sample."}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
                  No residual videos were recorded for this check.
                </p>
              )}
              {data.parityEvidence.residualReasonTruncatedCount > 0 ? (
                <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
                  {data.parityEvidence.residualReasonTruncatedCount} additional
                  reason(s) were omitted from the persisted sample.
                </p>
              ) : null}
              <p className="mt-4 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                For complete execution detail, open the{" "}
                <Link className="underline" href="/dashboard/workflows">
                  Core Sync run ledger
                </Link>{" "}
                and look up stable check ID{" "}
                <span className="break-all font-mono">
                  {data.parityEvidence.checkId}
                </span>
                .
              </p>
            </section>
          </div>
        ) : (
          <div className="p-4 text-[13px] leading-6 text-[var(--color-text-secondary)]">
            No complete, supported subtitle parity check is available. Open the{" "}
            <Link className="underline" href="/dashboard/workflows">
              Core Sync run ledger
            </Link>{" "}
            to inspect execution attempts; parity remains unavailable until a
            completed check is persisted.
          </div>
        )}
      </PageSection>
    </div>
  )
}
