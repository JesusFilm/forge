import type {
  JobArtifactManifest,
  SceneEmbeddingSyncReport,
  SceneEmbeddingSyncStatus,
} from "@/types/job"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
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
    value === "indexed" ||
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
    ...(readString(value.videoDocumentId)
      ? { videoDocumentId: readString(value.videoDocumentId) }
      : {}),
    ...(readNumber(value.resolvedVideoId) != null
      ? { resolvedVideoId: readNumber(value.resolvedVideoId) }
      : {}),
    ...(readString(value.reason) ? { reason: readString(value.reason) } : {}),
    ...(readString(value.model) ? { model: readString(value.model) } : {}),
    ...(readNumber(value.dimensions) != null
      ? { dimensions: readNumber(value.dimensions) }
      : {}),
    ...(readNumber(value.indexedSceneCount) != null
      ? { indexedSceneCount: readNumber(value.indexedSceneCount) }
      : {}),
    ...(readNumber(value.embeddingTokens) != null
      ? { embeddingTokens: readNumber(value.embeddingTokens) }
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
