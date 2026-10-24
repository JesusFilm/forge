import type { JobRecord, WorkflowStepName } from "@/types/job"

const REVIEW_RELEVANT_STEPS = new Set<WorkflowStepName>([
  "structured_transcript",
  "subtitle_post_process",
  "chapters",
  "metadata",
  "translation",
  "mux_upload",
])

function getTerminalStatusKey(status: JobRecord["status"]): string {
  return status === "completed" || status === "failed" ? status : "active"
}

function getStableValueKey(value: unknown): string {
  if (value == null) {
    return "null"
  }

  if (Array.isArray(value)) {
    return `[${value.map(getStableValueKey).join(",")}]`
  }

  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => `${key}:${getStableValueKey(nestedValue)}`)
      .join(",")}}`
  }

  return String(value)
}

function getRelevantArtifactKey(job: JobRecord): string {
  return Object.entries(job.artifacts)
    .filter(([artifactKey]) => {
      return (
        artifactKey === "metadata" ||
        artifactKey === "chapters" ||
        artifactKey === "chapters-vtt" ||
        artifactKey === "muxSync" ||
        artifactKey === "subtitles" ||
        artifactKey === "subtitles-raw" ||
        artifactKey === "transcript-correction-report" ||
        artifactKey === "transcript-raw" ||
        artifactKey.startsWith("subtitle-validation-") ||
        artifactKey.startsWith("subtitles-")
      )
    })
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([artifactKey, artifact]) => {
      const dataKey =
        artifact.kind === "metadata" ? getStableValueKey(artifact.data) : ""
      return `${artifactKey}:${artifact.kind}:${dataKey}`
    })
    .join("|")
}

function getRelevantStepKey(job: JobRecord): string {
  return job.steps
    .filter((step) => REVIEW_RELEVANT_STEPS.has(step.name))
    .map((step) =>
      [
        step.name,
        step.status,
        step.retries,
        step.startedAt ?? "",
        step.finishedAt ?? "",
        step.error ?? "",
        getStableValueKey(step.details),
      ].join(":"),
    )
    .join("|")
}

export function getReviewContextRefreshKey(job: JobRecord): string {
  return [
    job.id,
    job.muxAssetId,
    job.muxPlaybackId,
    job.videoDocumentId ?? "",
    job.sourceLanguageCode ?? "",
    getTerminalStatusKey(job.status),
    getRelevantArtifactKey(job),
    getRelevantStepKey(job),
  ].join("::")
}
