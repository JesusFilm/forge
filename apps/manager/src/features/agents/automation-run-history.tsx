import type { EnrichmentAutomationRun } from "./automation-contract"
import { Badge } from "@/components/ui/badge"

const RUN_STATUS_LABELS: Record<EnrichmentAutomationRun["status"], string> = {
  claimed: "Claimed",
  running: "Running",
  success: "Success",
  partial: "Partial",
  failed: "Failed",
  no_op: "No eligible videos",
}

function formatDateTime(value?: string | null): string {
  if (!value) return "n/a"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function AutomationRunHistory({
  runs,
}: {
  runs: EnrichmentAutomationRun[]
}) {
  if (runs.length === 0) {
    return (
      <p className="text-[14px] leading-6 text-muted-foreground">
        No runs yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <div
          key={run.documentId}
          className="grid gap-2 rounded-[1.35rem] border border-border/80 bg-secondary/28 px-4 py-3 text-[0.95rem] leading-6 text-muted-foreground sm:grid-cols-[auto_auto_1fr] sm:items-center"
        >
          <Badge variant={run.status === "success" ? "success" : "pending"}>
            {RUN_STATUS_LABELS[run.status]}
          </Badge>
          <span className="font-medium text-foreground">
            {formatDateTime(run.startedAt ?? run.scheduledFor)}
          </span>
          <span>
            {run.enqueuedCount} enqueued
            {run.skippedDuplicateCount > 0
              ? `, ${run.skippedDuplicateCount} skipped`
              : ""}
          </span>
          {run.summary ? (
            <span className="sm:col-span-3">{run.summary}</span>
          ) : null}
        </div>
      ))}
    </div>
  )
}
