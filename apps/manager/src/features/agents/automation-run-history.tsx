import type { EnrichmentAutomationRun } from "./automation-contract"

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
    return <p className="small agents-run-empty">No runs yet.</p>
  }

  return (
    <div className="agents-run-history">
      {runs.map((run) => (
        <div key={run.documentId} className="agents-run-row">
          <span
            className={`badge ${run.status === "no_op" ? "skipped" : run.status}`}
          >
            {RUN_STATUS_LABELS[run.status]}
          </span>
          <span>{formatDateTime(run.startedAt ?? run.scheduledFor)}</span>
          <span>
            {run.enqueuedCount} enqueued
            {run.skippedDuplicateCount > 0
              ? `, ${run.skippedDuplicateCount} skipped`
              : ""}
          </span>
          {run.summary && <span className="small">{run.summary}</span>}
        </div>
      ))}
    </div>
  )
}
