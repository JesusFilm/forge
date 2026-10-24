import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { StatusPill } from "@/components/admin-ui"
import { requireSession } from "@/auth/session"
import { loadWorkflowRuntimeRunDetail } from "@/services/workflow-runtime.service"
import { WorkflowTraceClient } from "../workflow-trace-client"

type WorkflowRunPageProps = {
  params: Promise<{ runId: string }>
}

function statusToneForWorkflowStatus(
  status: string,
): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "completed" || status === "succeeded") return "success"
  if (status === "failed") return "danger"
  if (status === "cancelled" || status === "skipped") return "warning"
  if (status === "running") return "info"
  return "muted"
}

function displayNameFromWorkflowName(workflowName: string): string {
  const parts = workflowName.split("//").filter(Boolean)
  return parts[parts.length - 1] ?? workflowName
}

export default async function WorkflowRunPage({
  params,
}: WorkflowRunPageProps) {
  const { runId } = await params
  await requireSession()
  const detail = await loadWorkflowRuntimeRunDetail(runId)

  if (!detail) {
    notFound()
  }

  const title = displayNameFromWorkflowName(detail.run.workflowName)

  return (
    <div className="flex h-[calc(100vh-48px)] min-h-0 flex-col overflow-hidden bg-[var(--color-bg)]">
      <div className="flex min-h-12 items-center gap-3 border-b border-[var(--color-hairline)] bg-[var(--color-surface)] px-4">
        <Link
          href="/dashboard/workflows"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
          aria-label="Back to workflow runs"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[13px] font-medium">{title}</h1>
          <div className="mono-meta truncate text-[var(--color-text-muted)]">
            {detail.run.runId}
          </div>
        </div>
        <StatusPill tone={statusToneForWorkflowStatus(detail.run.status)}>
          {detail.run.status}
        </StatusPill>
      </div>

      <WorkflowTraceClient
        run={detail.run}
        events={detail.events}
        steps={detail.steps}
        hooks={detail.hooks}
        hasMoreEvents={detail.hasMoreEvents}
        hasMoreSteps={detail.hasMoreSteps}
        hasMoreHooks={detail.hasMoreHooks}
      />
    </div>
  )
}
