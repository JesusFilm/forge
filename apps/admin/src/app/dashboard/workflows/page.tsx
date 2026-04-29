import { revalidatePath } from "next/cache"
import { RefreshCcw, Workflow } from "lucide-react"
import {
  DashboardPageHeader,
  InsightGrid,
  OperatorRail,
  PageSection,
  PrimaryButton,
  QueueList,
} from "@/components/admin-ui"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import { loadWorkflowsData } from "@/app/dashboard/ops-data"
import { dispatchCoreSync } from "@/services/core-sync/job"

export default async function WorkflowsPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.workflows
  const principal = await requireSession()
  const data = await loadWorkflowsData()
  const canTriggerSync = hasPermission(principal, "system:trigger-workflow")

  async function triggerSyncAction() {
    "use server"

    const user = await requireSession()
    if (!hasPermission(user, "system:trigger-workflow")) {
      return
    }

    await dispatchCoreSync({ incremental: true, trigger: "manual" })
    revalidatePath("/dashboard")
    revalidatePath("/dashboard/system-status")
    revalidatePath("/dashboard/workflows")
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        action={
          canTriggerSync ? (
            <form action={triggerSyncAction}>
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-2 rounded-sm bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)]"
              >
                <RefreshCcw className="h-4 w-4" strokeWidth={1.5} />
                Trigger Delta Sync
              </button>
            </form>
          ) : (
            <PrimaryButton className="opacity-60">Read-only</PrimaryButton>
          )
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {data.metrics.map((card) => (
          <div key={card.label} className="app-card flex flex-col gap-2 p-4">
            <span className="label-text">{card.label}</span>
            <span className="font-mono text-xl font-medium">{card.value}</span>
            <span className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
              {card.footer}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="flex flex-col gap-6">
          <PageSection
            title="Workflow Activity"
            meta="POSTGRES_WORLD / LEDGER / CORE_SYNC"
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

          <PageSection title="Execution Signals" meta="WORKFLOW_POSTURE">
            <div className="p-4">
              <InsightGrid
                items={data.insights.map((item) => ({
                  ...item,
                  icon: Workflow,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes={
            data.syncLockHeld
              ? "A sync workflow currently holds the DB-backed lock. Use this page to confirm the system is moving rather than piling on duplicate runs."
              : "This page reads Workflow runtime rows first, then joins the admin workflow ledger for trigger, subject, and Core Sync context."
          }
          chips={[
            { label: "Lock", value: data.syncLockHeld ? "HELD" : "CLEAR" },
            {
              label: "Manual Sync",
              value: canTriggerSync ? "AVAILABLE" : "ADMIN_ONLY",
            },
            { label: "Surface", value: "WORKFLOW_OPERATIONS" },
          ]}
        />
      </div>
    </div>
  )
}
