import { Activity } from "lucide-react"
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
  const exceptionCount = Number(metricValue(data.metrics, "Exceptions"))
  const latestAttemptedSync = metricValue(data.metrics, "Latest Attempted Sync")
  const isRunning = lockState === "HELD"
  const needsReview =
    latestAttemptedSync === "failed" ||
    latestAttemptedSync === "FAILED" ||
    exceptionCount > 0
  const verdict = isRunning
    ? {
        label: "Core Sync is running",
        detail:
          "The DB-backed lock is held. Wait for this run to finish before starting another.",
        tone: "info" as const,
      }
    : needsReview
      ? {
          label: "Core Sync needs review",
          detail: "A synced data set or recent sync attempt needs review.",
          tone: "warning" as const,
        }
      : {
          label: "Core Sync is healthy",
          detail: "No active lock. Sync state is current.",
          tone: "success" as const,
        }

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

      <section className="app-card p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Activity
                className="h-4 w-4 text-[var(--color-text-muted)]"
                strokeWidth={1.5}
              />
              <StatusPill tone={verdict.tone}>{verdict.label}</StatusPill>
            </div>
            <p className="max-w-3xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
              {verdict.detail}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:min-w-[520px]">
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
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <PageSection title="Sync State" meta="SYNC_STATE">
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
    </div>
  )
}
