export type EnrichJobResult = {
  videoId: string
  jobId: string
}

export type EnrichErrorResult = {
  videoId: string
  error: string
}

export type EnrichApiResponse = {
  created: number
  failed: number
  jobs?: EnrichJobResult[]
  errors?: EnrichErrorResult[]
}

export type EnrichFeedback = {
  tone: "neutral" | "success" | "error"
  message: string
}

export type EnrichSelectionOutcome = {
  feedback: EnrichFeedback | null
  nextSelectedVideoIds: Set<string>
  redirectPath: string | null
}

export function getVideoQaSelectionDisabledReason(
  videoId: string,
): string | null {
  if (videoId.startsWith("collection:")) {
    return "Collections can't be enriched directly. Expand the collection and select one or more videos."
  }

  return null
}

export function isVideoQaSelectable(videoId: string): boolean {
  return getVideoQaSelectionDisabledReason(videoId) == null
}

export function requiresLanguageSelectionForEnrich(
  selectedVideoCount: number,
  selectedLanguageCount: number,
): boolean {
  return selectedVideoCount > 0 && selectedLanguageCount === 0
}

export function isEnrichActionReady(
  selectedVideoCount: number,
  selectedLanguageCount: number,
): boolean {
  return selectedVideoCount > 0 && selectedLanguageCount > 0
}

function formatErrorList(errors: EnrichErrorResult[]): string {
  return errors.map(({ videoId, error }) => `${videoId}: ${error}`).join("; ")
}

export function resolveEnrichSelectionOutcome(
  selectedVideoIds: Set<string>,
  result: EnrichApiResponse,
): EnrichSelectionOutcome {
  const jobs = result.jobs ?? []
  const errors = result.errors ?? []

  if (errors.length === 0) {
    return {
      feedback: null,
      nextSelectedVideoIds: new Set(),
      redirectPath:
        jobs.length === 1
          ? `/dashboard/jobs/${jobs[0]?.jobId ?? ""}`
          : jobs.length > 1
            ? "/dashboard/jobs"
            : null,
    }
  }

  const failedVideoIds = new Set(errors.map((entry) => entry.videoId))
  const nextSelectedVideoIds = new Set(
    Array.from(selectedVideoIds).filter((videoId) =>
      failedVideoIds.has(videoId),
    ),
  )

  if (jobs.length === 0) {
    return {
      feedback: {
        tone: "error",
        message:
          errors.length > 0
            ? formatErrorList(errors)
            : "No enrichment jobs were created.",
      },
      nextSelectedVideoIds,
      redirectPath: null,
    }
  }

  return {
    feedback: {
      tone: "neutral",
      message: `${jobs.length} enrichment job${jobs.length === 1 ? "" : "s"} created. ${errors.length} video${errors.length === 1 ? "" : "s"} skipped: ${formatErrorList(errors)}`,
    },
    nextSelectedVideoIds,
    redirectPath: null,
  }
}
