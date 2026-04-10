export type EnrichFeedback = {
  tone: "neutral" | "success" | "error"
  message: string
}

type EnrichJobResult = {
  videoId: string
  jobId: string
}

type EnrichErrorResult = {
  videoId: string
  error: string
}

type EnrichSelectionResponse = {
  created: number
  failed: number
  jobs?: EnrichJobResult[]
  errors?: EnrichErrorResult[]
}

type EnrichSelectionOutcome = {
  nextSelectedVideoIds: Set<string>
  redirectPath?: "/dashboard/jobs" | `/dashboard/jobs/${string}`
  feedback: EnrichFeedback | null
}

const COLLECTION_VIDEO_ID_PREFIX = "collection:"

function formatFailureSummary(errors: EnrichErrorResult[]): string {
  if (errors.length === 0) {
    return "No enrichment jobs were created."
  }

  const firstError = errors[0]
  if (!firstError) {
    return "No enrichment jobs were created."
  }

  if (errors.length === 1) {
    return `Could not enrich 1 video: ${firstError.error}.`
  }

  return `Could not enrich ${errors.length} videos. First failure: ${firstError.error}.`
}

export function isVideoQaSelectable(videoId: string): boolean {
  return !videoId.startsWith(COLLECTION_VIDEO_ID_PREFIX)
}

export function getVideoQaSelectionDisabledReason(
  videoId: string,
): string | null {
  if (isVideoQaSelectable(videoId)) {
    return null
  }

  return "Collection summary rows cannot be enriched directly."
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

export function resolveEnrichSelectionOutcome(
  selectedVideoIds: ReadonlySet<string>,
  response: EnrichSelectionResponse,
): EnrichSelectionOutcome {
  const jobs = response.jobs ?? []
  const errors = response.errors ?? []
  const createdVideoIds = new Set(jobs.map((job) => job.videoId))
  const nextSelectedVideoIds = new Set(
    Array.from(selectedVideoIds).filter(
      (videoId) => !createdVideoIds.has(videoId),
    ),
  )

  if (response.failed === 0 && jobs.length === 1) {
    const [job] = jobs
    if (job) {
      return {
        nextSelectedVideoIds: new Set(),
        redirectPath: `/dashboard/jobs/${job.jobId}`,
        feedback: null,
      }
    }
  }

  if (response.failed === 0 && jobs.length > 1) {
    return {
      nextSelectedVideoIds: new Set(),
      redirectPath: "/dashboard/jobs",
      feedback: null,
    }
  }

  if (response.created > 0) {
    return {
      nextSelectedVideoIds,
      feedback: {
        tone: "neutral",
        message: `Created ${response.created} enrichment job${response.created === 1 ? "" : "s"}. ${formatFailureSummary(errors)}`,
      },
    }
  }

  return {
    nextSelectedVideoIds,
    feedback: {
      tone: "error",
      message: formatFailureSummary(errors),
    },
  }
}
