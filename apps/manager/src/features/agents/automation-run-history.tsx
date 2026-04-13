import type { EnrichmentAutomationRun } from "./automation-contract"

const RUN_STATUS_LABELS: Record<EnrichmentAutomationRun["status"], string> = {
  claimed: "Claimed",
  running: "Running",
  success: "Success",
  partial: "Partial",
  failed: "Failed",
  no_op: "No eligible videos",
}

function formatEnqueueSummary(run: EnrichmentAutomationRun): string {
  const report = run.report?.data
  if (run.runMode === "dry_run" && report) {
    return `${report.wouldEnqueueCount} would enqueue, ${run.enqueuedCount} enqueued${
      run.skippedDuplicateCount > 0
        ? `, ${run.skippedDuplicateCount} skipped`
        : ""
    }`
  }

  return `${run.enqueuedCount} enqueued${
    run.skippedDuplicateCount > 0
      ? `, ${run.skippedDuplicateCount} skipped`
      : ""
  }`
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
          {run.runMode === "dry_run" && (
            <span className="badge skipped">Dry run</span>
          )}
          <span>{formatDateTime(run.startedAt ?? run.scheduledFor)}</span>
          <span>{formatEnqueueSummary(run)}</span>
          {run.summary && <span className="small">{run.summary}</span>}
          {run.runMode === "dry_run" && run.report?.data && (
            <details className="agents-run-report">
              <summary>Dry-run report</summary>
              <dl className="agents-run-report-grid">
                <div>
                  <dt>Eligible</dt>
                  <dd>{run.report.data.eligibleCount}</dd>
                </div>
                <div>
                  <dt>Would enqueue</dt>
                  <dd>{run.report.data.wouldEnqueueCount}</dd>
                </div>
                <div>
                  <dt>Suppressed</dt>
                  <dd>{run.report.data.suppressedOperations.join(", ")}</dd>
                </div>
                <div>
                  <dt>Selected</dt>
                  <dd>
                    {run.report.data.selectedCandidates.length > 0
                      ? run.report.data.selectedCandidates
                          .map((candidate) => candidate.videoDocumentId)
                          .join(", ")
                      : "None"}
                  </dd>
                </div>
              </dl>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}
