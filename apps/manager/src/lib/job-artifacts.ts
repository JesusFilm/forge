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
  subtitles: {
    artifactType: "subtitles",
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
  transcript: "Transcript raw",
  subtitles: "Subtitles processed",
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
  "smart-crop-timeline-map": "Smart Crop timeline map",
  "smart-crop-qa": "Smart Crop QA report",
  "smart-crop-preview": "Smart Crop preview video",
  "smart-crop-output": "Smart Crop output video",
  "smart-crop-render-report-preview": "Smart Crop render report (preview)",
  "smart-crop-render-report-full": "Smart Crop render report (full)",
}

const SMART_CROP_PREVIEW_FRAME_PATTERN = /^smart-crop-preview-frame-9x16-\d{3}$/

const STEP_ARTIFACT_KEYS: Partial<Record<WorkflowStepName, string[]>> = {
  transcription: ["transcript", "subtitles", "subtitlesVtt"],
  chapters: ["chapters", "chapters-vtt"],
  metadata: ["metadata"],
  embeddings: ["embeddings"],
  audio_cleanup: ["original-audio", "cleaned-audio"],
  smart_crop_fingerprint: ["smart-crop-fingerprint"],
  smart_crop_plan: ["smart-crop-plan"],
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

  if (SMART_CROP_PREVIEW_FRAME_PATTERN.test(logicalKey)) {
    return `Smart Crop preview frame ${logicalKey.slice(-3)}`
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

  return null
}

function buildSmartCropPreviewFrameDescriptor(
  logicalKey: string,
): JobArtifactDescriptor | null {
  if (!SMART_CROP_PREVIEW_FRAME_PATTERN.test(logicalKey)) {
    return null
  }

  return {
    artifactType: logicalKey,
    ext: "jpg",
    contentType: "image/jpeg",
  }
}

export function resolveJobArtifactDescriptor(
  logicalKey: string,
): JobArtifactDescriptor | null {
  return (
    EXACT_JOB_ARTIFACTS[logicalKey] ??
    buildTranslationArtifactDescriptor(logicalKey) ??
    buildSmartCropPreviewFrameDescriptor(logicalKey)
  )
}

export function buildJobArtifactHref(
  jobId: string,
  logicalKey: string,
): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(logicalKey)}`
}

// Smart-crop artifacts are stored under the job's smartCrop assetId
// (`options.smartCrop.assetId`), which may differ from `job.muxAssetId` —
// the storage prefix used by enrichment artifacts. Keep both halves of this
// contract in sync: POST /api/smart-crop/jobs stores the assetId on
// `options.smartCrop`, and the artifact download route resolves the storage
// prefix through this helper.
export function getJobArtifactStorageAssetId(
  job: Pick<JobRecord, "muxAssetId" | "options">,
): string {
  return job.options.smartCrop?.assetId ?? job.muxAssetId
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
            key === "translations"),
      )
      .sort(([left], [right]) => left.localeCompare(right))
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
