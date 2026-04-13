export type EnrichFeedback = {
  tone: "neutral" | "success" | "error"
  message: string
  action?: {
    href: "/dashboard/jobs" | `/dashboard/jobs/${string}`
    label: string
  }
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
  redirectPath?: "/dashboard/jobs" | `/dashboard/jobs/${string}` | null
  feedback: EnrichFeedback | null
}

const COLLECTION_VIDEO_ID_PREFIX = "collection:"

function formatFailureSummary(errors: EnrichErrorResult[]): string {
  if (errors.length === 0) {
    return "No enrichment jobs were created."
  }

  return formatErrorList(errors)
}

function formatErrorList(errors: EnrichErrorResult[]): string {
  return errors.map(({ videoId, error }) => `${videoId}: ${error}`).join("; ")
}

function getJobsAction(jobs: EnrichJobResult[]): EnrichFeedback["action"] {
  if (jobs.length === 1) {
    const [job] = jobs
    if (!job) return undefined

    return {
      href: `/dashboard/jobs/${job.jobId}`,
      label: "Open job",
    }
  }

  if (jobs.length > 1) {
    return {
      href: "/dashboard/jobs",
      label: "View jobs",
    }
  }

  return undefined
}

function formatStartedJobsMessage(count: number): string {
  return `${count} enrichment job${count === 1 ? "" : "s"} started.`
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

  return "Collections can't be enriched directly. Expand the collection and select one or more videos."
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

export function isEnrichSelectionInputEnabled({
  isSelectMode,
  isSelectable,
  isSubmitting,
}: {
  isSelectMode: boolean
  isSelectable: boolean
  isSubmitting: boolean
}): boolean {
  return isSelectMode && isSelectable && !isSubmitting
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

  if (response.failed === 0) {
    return {
      nextSelectedVideoIds: new Set(),
      redirectPath: null,
      feedback:
        response.created > 0
          ? {
              tone: "success",
              message: formatStartedJobsMessage(response.created),
              action: getJobsAction(jobs),
            }
          : null,
    }
  }

  if (response.created > 0) {
    return {
      nextSelectedVideoIds,
      feedback: {
        tone: "neutral",
        message: `${formatStartedJobsMessage(response.created)} ${errors.length} video${errors.length === 1 ? "" : "s"} failed: ${formatErrorList(errors)}`,
        action: getJobsAction(jobs),
      },
      redirectPath: null,
    }
  }

  return {
    nextSelectedVideoIds,
    feedback: {
      tone: "error",
      message: formatFailureSummary(errors),
    },
    redirectPath: null,
  }
}
