import type {
  JobArtifactManifest,
  JobRecord,
  WorkflowStepName,
} from "@/types/job"

export type JobArtifactDescriptor = {
  artifactType: string
  ext: "json" | "vtt" | "mp3" | "mp4" | "jpg"
  contentType: string
}

export type JobStepArtifactLink = {
  key: string
  label: string
  url: string
}

const EXACT_JOB_ARTIFACTS: Record<string, JobArtifactDescriptor> = {
  transcript: {
    artifactType: "transcript",
    ext: "json",
    contentType: "application/json",
  },
  "transcript-raw": {
    artifactType: "transcript-raw",
    ext: "json",
    contentType: "application/json",
  },
  "transcript-correction-report": {
    artifactType: "transcript-correction-report",
    ext: "json",
    contentType: "application/json",
  },
  subtitles: {
    artifactType: "subtitles",
    ext: "vtt",
    contentType: "text/vtt; charset=utf-8",
  },
  "subtitles-raw": {
    artifactType: "subtitles-raw",
    ext: "vtt",
    contentType: "text/vtt; charset=utf-8",
  },
  subtitlesVtt: {
    artifactType: "subtitles",
    ext: "vtt",
    contentType: "text/vtt; charset=utf-8",
  },
  chapters: {
    artifactType: "chapters",
    ext: "json",
    contentType: "application/json",
  },
  "chapters-vtt": {
    artifactType: "chapters-vtt",
    ext: "vtt",
    contentType: "text/vtt; charset=utf-8",
  },
  metadata: {
    artifactType: "metadata",
    ext: "json",
    contentType: "application/json",
  },
  embeddings: {
    artifactType: "embeddings",
    ext: "json",
    contentType: "application/json",
  },
  translations: {
    artifactType: "translations",
    ext: "json",
    contentType: "application/json",
  },
  "original-audio": {
    artifactType: "original-audio",
    ext: "mp3",
    contentType: "audio/mpeg",
  },
  "cleaned-audio": {
    artifactType: "cleaned-audio",
    ext: "mp3",
    contentType: "audio/mpeg",
  },
  // Smart Crop artifacts (plan 2026-06-09-002 "Artifact contracts").
  // NOTE: smart-crop artifacts are stored under the job's smartCrop assetId
  // (options.smartCrop.assetId), which the artifact download route resolves
  // via getJobArtifactStorageAssetId below.
  "smart-crop-fingerprint": {
    artifactType: "smart-crop-fingerprint-v1",
    ext: "json",
    contentType: "application/json",
  },
  "smart-crop-plan": {
    artifactType: "smart-crop-plan-9x16-v1",
    ext: "json",
    contentType: "application/json",
  },
  "smart-crop-attempts": {
    artifactType: "smart-crop-attempts-9x16-v1",
    ext: "json",
    contentType: "application/json",
  },
  "smart-crop-timeline-map": {
    artifactType: "smart-crop-timeline-map-v1",
    ext: "json",
    contentType: "application/json",
  },
  "smart-crop-qa": {
    artifactType: "smart-crop-qa-9x16-v1",
    ext: "json",
    contentType: "application/json",
  },
  "smart-crop-preview": {
    artifactType: "smart-crop-preview-9x16",
    ext: "mp4",
    contentType: "video/mp4",
  },
  "smart-crop-output": {
    artifactType: "smart-crop-output-9x16",
    ext: "mp4",
    contentType: "video/mp4",
  },
  "smart-crop-render-report-preview": {
    artifactType: "smart-crop-render-report-9x16-preview",
    ext: "json",
    contentType: "application/json",
  },
  "smart-crop-render-report-full": {
    artifactType: "smart-crop-render-report-9x16-full",
    ext: "json",
    contentType: "application/json",
  },
}

const EXACT_JOB_ARTIFACT_LABELS: Record<string, string> = {
  transcript: "Transcript JSON",
  "transcript-raw": "Transcript raw",
  "transcript-correction-report": "Transcript correction report",
  subtitles: "Subtitles VTT",
  "subtitles-raw": "Subtitles raw",
  subtitlesVtt: "Subtitles processed",
  chapters: "Chapters JSON",
  "chapters-vtt": "Chapters VTT",
  metadata: "Metadata JSON",
  embeddings: "Embeddings JSON",
  translations: "Translations JSON",
  "original-audio": "Audio raw",
  "cleaned-audio": "Audio clean",
  "smart-crop-fingerprint": "Smart Crop fingerprint",
  "smart-crop-plan": "Smart Crop plan",
  "smart-crop-attempts": "Smart Crop attempts",
  "smart-crop-timeline-map": "Smart Crop timeline map",
  "smart-crop-qa": "Smart Crop QA report",
  "smart-crop-preview": "Smart Crop preview video",
  "smart-crop-output": "Smart Crop output video",
  "smart-crop-render-report-preview": "Smart Crop render report (preview)",
  "smart-crop-render-report-full": "Smart Crop render report (full)",
}

const SMART_CROP_PREVIEW_FRAME_PATTERN = /^smart-crop-preview-frame-9x16-\d{3}$/
const SMART_CROP_ATTEMPT_PATTERN = /-attempt-(\d{3})(?:-|$)/
const SMART_CROP_PLAN_ATTEMPT_PATTERN = /^smart-crop-plan-attempt-\d{3}$/
const SMART_CROP_QA_ATTEMPT_PATTERN = /^smart-crop-qa-attempt-\d{3}$/
const SMART_CROP_PREVIEW_ATTEMPT_PATTERN = /^smart-crop-preview-attempt-\d{3}$/
const SMART_CROP_RENDER_REPORT_PREVIEW_ATTEMPT_PATTERN =
  /^smart-crop-render-report-preview-attempt-\d{3}$/
const SMART_CROP_PREVIEW_FRAME_ATTEMPT_PATTERN =
  /^smart-crop-preview-frame-9x16-\d{3}-attempt-\d{3}$/

const STEP_ARTIFACT_KEYS: Partial<Record<WorkflowStepName, string[]>> = {
  transcription: ["transcript", "subtitles", "subtitlesVtt"],
  structured_transcript: [
    "transcript-correction-report",
    "transcript-raw",
    "subtitles-raw",
  ],
  chapters: ["chapters", "chapters-vtt"],
  metadata: ["metadata"],
  embeddings: ["embeddings"],
  audio_cleanup: ["original-audio", "cleaned-audio"],
  smart_crop_fingerprint: ["smart-crop-fingerprint"],
  smart_crop_plan: ["smart-crop-plan", "smart-crop-attempts"],
  smart_crop_align: ["smart-crop-timeline-map"],
  smart_crop_preview_render: [
    "smart-crop-preview",
    "smart-crop-render-report-preview",
  ],
  smart_crop_qa: ["smart-crop-qa"],
  smart_crop_render: ["smart-crop-output", "smart-crop-render-report-full"],
}

function buildDynamicArtifactLabel(logicalKey: string): string {
  if (logicalKey.startsWith("subtitles-")) {
    return `Subtitles ${logicalKey.slice("subtitles-".length)}`
  }

  if (logicalKey.startsWith("translation-")) {
    return `Translation ${logicalKey.slice("translation-".length)}`
  }

  if (logicalKey.startsWith("subtitle-validation-")) {
    return `Subtitle validation ${logicalKey.slice("subtitle-validation-".length)}`
  }

  if (SMART_CROP_PREVIEW_FRAME_PATTERN.test(logicalKey)) {
    return `Smart Crop preview frame ${logicalKey.slice(-3)}`
  }

  const attemptMatch = logicalKey.match(SMART_CROP_ATTEMPT_PATTERN)
  const attemptLabel = attemptMatch ? `attempt ${attemptMatch[1]}` : null

  if (SMART_CROP_PLAN_ATTEMPT_PATTERN.test(logicalKey)) {
    return `Smart Crop plan (${attemptLabel})`
  }
  if (SMART_CROP_QA_ATTEMPT_PATTERN.test(logicalKey)) {
    return `Smart Crop QA report (${attemptLabel})`
  }
  if (SMART_CROP_PREVIEW_ATTEMPT_PATTERN.test(logicalKey)) {
    return `Smart Crop preview video (${attemptLabel})`
  }
  if (SMART_CROP_RENDER_REPORT_PREVIEW_ATTEMPT_PATTERN.test(logicalKey)) {
    return `Smart Crop render report preview (${attemptLabel})`
  }
  if (SMART_CROP_PREVIEW_FRAME_ATTEMPT_PATTERN.test(logicalKey)) {
    const [, frame, attempt] =
      logicalKey.match(
        /^smart-crop-preview-frame-9x16-(\d{3})-attempt-(\d{3})$/,
      ) ?? []
    return `Smart Crop preview frame ${frame} (attempt ${attempt})`
  }

  return logicalKey
}

export function formatJobArtifactLabel(logicalKey: string): string {
  return (
    EXACT_JOB_ARTIFACT_LABELS[logicalKey] ??
    buildDynamicArtifactLabel(logicalKey)
  )
}

function buildTranslationArtifactDescriptor(
  logicalKey: string,
): JobArtifactDescriptor | null {
  if (logicalKey.startsWith("subtitles-")) {
    return {
      artifactType: logicalKey,
      ext: "vtt",
      contentType: "text/vtt; charset=utf-8",
    }
  }

  if (logicalKey.startsWith("translation-")) {
    return {
      artifactType: logicalKey,
      ext: "json",
      contentType: "application/json",
    }
  }

  if (logicalKey.startsWith("subtitle-validation-")) {
    return {
      artifactType: logicalKey,
      ext: "json",
      contentType: "application/json",
    }
  }

  return null
}

function buildSmartCropPreviewFrameDescriptor(
  logicalKey: string,
): JobArtifactDescriptor | null {
  if (
    !SMART_CROP_PREVIEW_FRAME_PATTERN.test(logicalKey) &&
    !SMART_CROP_PREVIEW_FRAME_ATTEMPT_PATTERN.test(logicalKey)
  ) {
    return null
  }

  return {
    artifactType: logicalKey,
    ext: "jpg",
    contentType: "image/jpeg",
  }
}

function buildSmartCropAttemptDescriptor(
  logicalKey: string,
): JobArtifactDescriptor | null {
  const planMatch = logicalKey.match(/^smart-crop-plan-attempt-(\d{3})$/)
  if (planMatch) {
    return {
      artifactType: `smart-crop-plan-9x16-attempt-${planMatch[1]}-v1`,
      ext: "json",
      contentType: "application/json",
    }
  }

  const qaMatch = logicalKey.match(/^smart-crop-qa-attempt-(\d{3})$/)
  if (qaMatch) {
    return {
      artifactType: `smart-crop-qa-9x16-attempt-${qaMatch[1]}-v1`,
      ext: "json",
      contentType: "application/json",
    }
  }

  const previewMatch = logicalKey.match(/^smart-crop-preview-attempt-(\d{3})$/)
  if (previewMatch) {
    return {
      artifactType: `smart-crop-preview-9x16-attempt-${previewMatch[1]}`,
      ext: "mp4",
      contentType: "video/mp4",
    }
  }

  const reportMatch = logicalKey.match(
    /^smart-crop-render-report-preview-attempt-(\d{3})$/,
  )
  if (reportMatch) {
    return {
      artifactType: `smart-crop-render-report-9x16-preview-attempt-${reportMatch[1]}`,
      ext: "json",
      contentType: "application/json",
    }
  }

  return null
}

export function resolveJobArtifactDescriptor(
  logicalKey: string,
): JobArtifactDescriptor | null {
  return (
    EXACT_JOB_ARTIFACTS[logicalKey] ??
    buildTranslationArtifactDescriptor(logicalKey) ??
    buildSmartCropPreviewFrameDescriptor(logicalKey) ??
    buildSmartCropAttemptDescriptor(logicalKey)
  )
}

function getTranslationArtifactSortRank(logicalKey: string): number {
  if (logicalKey.startsWith("subtitles-")) {
    return 0
  }

  if (logicalKey.startsWith("subtitle-validation-")) {
    return 1
  }

  if (logicalKey.startsWith("translation-")) {
    return 2
  }

  return 3
}

export function buildJobArtifactHref(
  jobId: string,
  logicalKey: string,
): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(logicalKey)}`
}

// Smart-crop artifacts are stored under the job's smartCrop assetId
// (`options.smartCrop.assetId`) and shorts artifacts under the job's shorts
// assetId (`options.shorts.assetId`), which may differ from `job.muxAssetId`
// — the storage prefix used by enrichment artifacts. Keep both halves of
// this contract in sync: POST /api/smart-crop/jobs and POST /api/shorts/jobs
// store the assetId on their options discriminator, and the artifact routes
// resolve the storage prefix through this helper. A job carries at most one
// of the two discriminators.
export function getJobArtifactStorageAssetId(
  job: Pick<JobRecord, "muxAssetId" | "options">,
): string {
  return (
    job.options.smartCrop?.assetId ??
    job.options.shorts?.assetId ??
    job.muxAssetId
  )
}

export function buildDownloadableArtifactManifest(
  logicalKeys: string[],
): JobArtifactManifest {
  return Object.fromEntries(
    logicalKeys.map((logicalKey) => [logicalKey, { kind: "downloadable" }]),
  )
}

export function getArtifactsForStep(
  stepName: WorkflowStepName,
  jobId: string,
  artifacts: JobArtifactManifest,
): JobStepArtifactLink[] {
  if (stepName === "translation") {
    return Object.entries(artifacts)
      .filter(
        ([key, value]) =>
          value.kind === "downloadable" &&
          (key.startsWith("subtitles-") ||
            key.startsWith("translation-") ||
            key.startsWith("subtitle-validation-") ||
            key === "translations"),
      )
      .sort(([left], [right]) => {
        const leftRank = getTranslationArtifactSortRank(left)
        const rightRank = getTranslationArtifactSortRank(right)
        return leftRank === rightRank
          ? left.localeCompare(right)
          : leftRank - rightRank
      })
      .map(([key]) => ({
        key,
        label: formatJobArtifactLabel(key),
        url: buildJobArtifactHref(jobId, key),
      }))
  }

  const keys = STEP_ARTIFACT_KEYS[stepName] ?? []
  return keys
    .map((key) => ({ key, entry: artifacts[key] }))
    .filter(
      (
        entry,
      ): entry is {
        key: string
        entry: { kind: "downloadable" }
      } => entry.entry?.kind === "downloadable",
    )
    .map(({ key }) => ({
      key,
      label: formatJobArtifactLabel(key),
      url: buildJobArtifactHref(jobId, key),
    }))
}
