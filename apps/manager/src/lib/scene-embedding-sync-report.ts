import type {
  JobArtifactManifest,
  SceneEmbeddingSyncReport,
  SceneEmbeddingSyncStatus,
} from "@/types/job"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const numbers = value.filter(
    (entry): entry is number =>
      typeof entry === "number" && Number.isFinite(entry),
  )

  return numbers.length === value.length ? numbers : undefined
}

function isSceneEmbeddingSyncStatus(
  value: unknown,
): value is SceneEmbeddingSyncStatus {
  return (
    value === "source_ready" ||
    value === "skipped_empty" ||
    value === "failed" ||
    value === "unsupported"
  )
}

export function normalizeSceneEmbeddingSyncReport(
  value: unknown,
): SceneEmbeddingSyncReport | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const generatedSceneCount = readNumber(value.generatedSceneCount)
  const indexableSceneCount = readNumber(value.indexableSceneCount)
  if (
    value.domain !== "scene_embeddings" ||
    !isSceneEmbeddingSyncStatus(value.status) ||
    generatedSceneCount == null ||
    indexableSceneCount == null
  ) {
    return undefined
  }

  return {
    domain: "scene_embeddings",
    status: value.status,
    generatedSceneCount,
    indexableSceneCount,
    ...(typeof value.reason === "string" && value.reason.trim().length > 0
      ? { reason: value.reason }
      : {}),
    ...(readNumberArray(value.skippedEmptySceneIndexes)
      ? {
          skippedEmptySceneIndexes: readNumberArray(
            value.skippedEmptySceneIndexes,
          ),
        }
      : {}),
  }
}

export function getSceneEmbeddingSyncReport(
  artifacts: JobArtifactManifest,
): SceneEmbeddingSyncReport | undefined {
  const artifact = artifacts.sceneEmbeddingSync
  if (artifact?.kind !== "metadata") {
    return undefined
  }

  return normalizeSceneEmbeddingSyncReport(artifact.data)
}

export function buildSceneEmbeddingSyncArtifact(
  report: SceneEmbeddingSyncReport,
): JobArtifactManifest {
  return {
    sceneEmbeddingSync: {
      kind: "metadata",
      data: report as unknown as Record<string, unknown>,
    },
  }
}
