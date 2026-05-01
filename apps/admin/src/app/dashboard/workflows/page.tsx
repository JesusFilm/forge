import { Workflow } from "lucide-react"
import {
  DashboardPageHeader,
  PageSection,
  PrimaryButton,
  QueueList,
  StatusPill,
} from "@/components/admin-ui"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import { loadWorkflowsData } from "@/app/dashboard/ops-data"
import { CoreSyncTriggerButton } from "./core-sync-trigger-button"

export default async function WorkflowsPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.workflows
  const principal = await requireSession()
  const data = await loadWorkflowsData()
  const canTriggerSync = hasPermission(principal, "system:trigger-workflow")

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
            <PrimaryButton className="opacity-60">Read-only</PrimaryButton>
          )
        }
      />

      <section className="app-card p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Workflow
                className="h-4 w-4 text-[var(--color-text-muted)]"
                strokeWidth={1.5}
              />
              <StatusPill tone={data.syncLockHeld ? "info" : "success"}>
                {data.syncLockHeld
                  ? "Core Sync running"
                  : "Workflow monitor ready"}
              </StatusPill>
            </div>
            <p className="max-w-3xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
              Recent workflow runs are shown below. Use this page to confirm
              scheduled jobs, manual jobs, and background backfills entered the
              runtime and where they ended up.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {data.metrics.map((card) => (
              <div
                key={card.label}
                className="min-w-[112px] rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-2"
              >
                <div className="label-text mb-1">{card.label}</div>
                <div className="font-mono text-[16px] font-medium">
                  {card.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PageSection
        title="Recent Workflow Runs"
        meta="RUNTIME / LEDGER"
        actions={
          <Workflow
            className="h-4 w-4 text-[var(--color-text-muted)]"
            strokeWidth={1.5}
          />
        }
      >
        <QueueList
          items={data.queue.map((item) => ({
            title: item.title,
            meta: item.meta,
            detail: item.detail,
            status: {
              label: item.statusLabel,
              tone: item.statusTone,
            },
          }))}
        />
      </PageSection>
    </div>
  )
}
