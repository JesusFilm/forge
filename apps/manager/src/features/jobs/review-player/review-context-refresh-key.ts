import type { JobRecord, WorkflowStepName } from "@/types/job"

const REVIEW_RELEVANT_STEPS = new Set<WorkflowStepName>([
  "structured_transcript",
  "subtitle_post_process",
  "chapters",
  "metadata",
  "mux_upload",
])

function getTerminalStatusKey(status: JobRecord["status"]): string {
  return status === "completed" || status === "failed" ? status : "active"
}

function getRelevantArtifactKey(job: JobRecord): string {
  return Object.entries(job.artifacts)
    .filter(([artifactKey]) => {
      return (
        artifactKey === "metadata" ||
        artifactKey === "chapters" ||
        artifactKey === "chapters-vtt" ||
        artifactKey === "subtitles" ||
        artifactKey.startsWith("subtitles-")
      )
    })
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([artifactKey, artifact]) => `${artifactKey}:${artifact.kind}`)
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
