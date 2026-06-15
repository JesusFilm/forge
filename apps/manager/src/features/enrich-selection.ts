export type EnrichFeedbackDetail = {
  label: string
  message: string
}

export type EnrichFeedback = {
  tone: "neutral" | "success" | "error"
  message: string
  details?: EnrichFeedbackDetail[]
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

type EnrichRequestErrorResponse = {
  error?: string
  details?: {
    formErrors?: string[]
    fieldErrors?: Record<string, string[] | undefined>
  }
  errors?: EnrichErrorResult[]
  unresolvedTargetLanguageIds?: string[]
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

function formatFeedbackDetail({
  label,
  message,
}: EnrichFeedbackDetail): string {
  if (label === "Request") {
    return message
  }

  return label ? `${label}: ${message}` : message
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

function getFirstRequestErrorDetail(
  response: EnrichRequestErrorResponse,
): string | null {
  const [detail] = getRequestErrorDetails(response)
  return detail ? formatFeedbackDetail(detail) : null
}

function getRequestErrorDetails(
  response: EnrichRequestErrorResponse,
): EnrichFeedbackDetail[] {
  const details: EnrichFeedbackDetail[] = []

  for (const formError of response.details?.formErrors ?? []) {
    const message = formError.trim()
    if (message) {
      details.push({ label: "Request", message })
    }
  }

  for (const [fieldName, fieldErrors] of Object.entries(
    response.details?.fieldErrors ?? {},
  )) {
    for (const fieldError of fieldErrors ?? []) {
      const message = fieldError.trim()
      if (message) {
        details.push({ label: fieldName, message })
      }
    }
  }

  details.push(...getPerVideoErrorDetails(response.errors ?? []))

  if (response.unresolvedTargetLanguageIds?.length) {
    details.push({
      label: "Unresolved language IDs",
      message: response.unresolvedTargetLanguageIds.join(", "),
    })
  }

  return details
}

function getPerVideoErrorDetails(
  errors: readonly EnrichErrorResult[],
): EnrichFeedbackDetail[] {
  return errors
    .map(({ videoId, error }) => ({
      label: videoId,
      message: error.trim(),
    }))
    .filter((detail) => detail.message.length > 0)
}

function withDetails(
  feedback: EnrichFeedback,
  details: EnrichFeedbackDetail[],
): EnrichFeedback {
  if (details.length === 0) {
    return feedback
  }

  return { ...feedback, details }
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

export function formatEnrichRequestErrorMessage(
  response: EnrichRequestErrorResponse,
  fallback = "Failed to create enrichment jobs.",
): string {
  const baseMessage = response.error?.trim() || fallback
  const detail = getFirstRequestErrorDetail(response)

  if (!detail || detail === baseMessage) {
    return baseMessage
  }

  return `${baseMessage}: ${detail}`
}

export function buildEnrichRequestErrorFeedback(
  response: EnrichRequestErrorResponse,
  fallback = "Failed to create enrichment jobs.",
): EnrichFeedback {
  return withDetails(
    {
      tone: "error",
      message: formatEnrichRequestErrorMessage(response, fallback),
    },
    getRequestErrorDetails(response),
  )
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
        details: getPerVideoErrorDetails(errors),
        action: getJobsAction(jobs),
      },
      redirectPath: null,
    }
  }

  return {
    nextSelectedVideoIds,
    feedback: withDetails(
      {
        tone: "error",
        message: formatFailureSummary(errors),
      },
      getPerVideoErrorDetails(errors),
    ),
    redirectPath: null,
  }
}
