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
 * Mirrors resolveEnrichSelectionOutcome's selection-preserved-on-failure
 * rule, but with copy suited to "Run Now" rather than "Enrich Now" — see
 * Key Technical Decision 4 in the Video Pipelines plan.
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
