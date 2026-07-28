import type { EnrichFeedback } from "@/features/enrich-selection"

type RunSelectionResponse = {
  created: number
  failed: number
}

export type RunSelectionOutcome = {
  nextSelectedIds: Set<string>
  feedback: EnrichFeedback | null
}

function formatQueuedMessage(count: number): string {
  return `${count} video${count === 1 ? "" : "s"} queued to run.`
}

function formatFailedMessage(count: number): string {
  return `Failed to queue ${count} video${count === 1 ? "" : "s"} to run.`
}

/**
 * On any failure, keeps the ENTIRE original selection rather than
 * narrowing to just the failed ids the way resolveEnrichSelectionOutcome
 * does — the stub /api/video-pipelines/run response has no per-id
 * success/failure breakdown to narrow by (see Key Technical Decision 4 in
 * the Video Pipelines plan). Re-check this once a real backend response
 * carries per-id detail.
 */
export function resolveRunSelectionOutcome(
  selectedIds: ReadonlySet<string>,
  response: RunSelectionResponse,
): RunSelectionOutcome {
  if (response.failed === 0) {
    return {
      nextSelectedIds: new Set(),
      feedback:
        response.created > 0
          ? { tone: "success", message: formatQueuedMessage(response.created) }
          : null,
    }
  }

  if (response.created > 0) {
    return {
      nextSelectedIds: new Set(selectedIds),
      feedback: {
        tone: "neutral",
        message: `${formatQueuedMessage(response.created)} ${formatFailedMessage(response.failed)}`,
      },
    }
  }

  return {
    nextSelectedIds: new Set(selectedIds),
    feedback: { tone: "error", message: formatFailedMessage(response.failed) },
  }
}
