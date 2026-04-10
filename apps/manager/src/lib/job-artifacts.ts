import type { JobArtifactManifest, WorkflowStepName } from "@/types/job"

export type JobArtifactDescriptor = {
  artifactType: string
  ext: "json" | "vtt"
  contentType: string
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
}

const STEP_ARTIFACT_KEYS: Partial<Record<WorkflowStepName, string[]>> = {
  transcription: ["transcript", "subtitles", "subtitlesVtt"],
  chapters: ["chapters"],
  metadata: ["metadata"],
  embeddings: ["embeddings"],
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

export function resolveJobArtifactDescriptor(
  logicalKey: string,
): JobArtifactDescriptor | null {
  return (
    EXACT_JOB_ARTIFACTS[logicalKey] ??
    buildTranslationArtifactDescriptor(logicalKey)
  )
}

export function buildJobArtifactHref(
  jobId: string,
  logicalKey: string,
): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(logicalKey)}`
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
): Array<{ key: string; url: string }> {
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
    .map(({ key }) => ({ key, url: buildJobArtifactHref(jobId, key) }))
}
