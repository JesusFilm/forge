import type {
  EmbeddingSyncCmsSummary,
  EmbeddingSyncGeneratedSummary,
  EmbeddingSyncOverrideSummary,
  EmbeddingSyncReport,
  EmbeddingSyncStatus,
  JobArtifactManifest,
} from "@/types/job"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isEmbeddingSyncStatus(value: unknown): value is EmbeddingSyncStatus {
  return (
    value === "applied_missing" ||
    value === "skipped_existing" ||
    value === "override_applied" ||
    value === "failed" ||
    value === "unsupported"
  )
}

function normalizeGeneratedSummary(
  value: unknown,
): EmbeddingSyncGeneratedSummary | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const model = readString(value.model)
  const dimensions = readNumber(value.dimensions)
  const chunkCount = readNumber(value.chunkCount)
  const contentFingerprint = readString(value.contentFingerprint)
  const hasMetadataEmbedding = readBoolean(value.hasMetadataEmbedding)

  if (
    !model ||
    dimensions == null ||
    chunkCount == null ||
    !contentFingerprint ||
    hasMetadataEmbedding == null
  ) {
    return undefined
  }

  return {
    model,
    dimensions,
    chunkCount,
    contentFingerprint,
    hasMetadataEmbedding,
    ...(readString(value.generatedAt)
      ? { generatedAt: readString(value.generatedAt) }
      : {}),
  }
}

function normalizeCmsSummary(
  value: unknown,
): EmbeddingSyncCmsSummary | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const resolvedVideoId = readNumber(value.resolvedVideoId)
  const hasEmbeddings = readBoolean(value.hasEmbeddings)
  const chunkCount = readNumber(value.chunkCount)

  if (resolvedVideoId == null || hasEmbeddings == null || chunkCount == null) {
    return undefined
  }

  return {
    resolvedVideoId,
    hasEmbeddings,
    chunkCount,
    ...(readString(value.model) ? { model: readString(value.model) } : {}),
    ...(readString(value.contentFingerprint)
      ? { contentFingerprint: readString(value.contentFingerprint) }
      : {}),
  }
}

function normalizeOverrideSummary(
  value: unknown,
): EmbeddingSyncOverrideSummary | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const approvedByUserId = readString(value.approvedByUserId)
  const approvedAt = readString(value.approvedAt)

  if (!approvedByUserId || !approvedAt) {
    return undefined
  }

  return {
    approvedByUserId,
    approvedAt,
  }
}

export function normalizeEmbeddingSyncReport(
  value: unknown,
): EmbeddingSyncReport | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if (value.domain !== "embeddings" || !isEmbeddingSyncStatus(value.status)) {
    return undefined
  }

  const generated = normalizeGeneratedSummary(value.generated)
  if (!generated) {
    return undefined
  }

  const cms = normalizeCmsSummary(value.cms)
  const override = normalizeOverrideSummary(value.override)

  return {
    domain: "embeddings",
    status: value.status,
    generated,
    ...(readString(value.videoDocumentId)
      ? { videoDocumentId: readString(value.videoDocumentId) }
      : {}),
    ...(readString(value.reason) ? { reason: readString(value.reason) } : {}),
    ...(cms ? { cms } : {}),
    ...(override ? { override } : {}),
  }
}

export function getEmbeddingSyncReport(
  artifacts: JobArtifactManifest,
): EmbeddingSyncReport | undefined {
  const artifact = artifacts.embeddingSync
  if (artifact?.kind !== "metadata") {
    return undefined
  }

  return normalizeEmbeddingSyncReport(artifact.data)
}

export function buildEmbeddingSyncArtifact(
  report: EmbeddingSyncReport,
): JobArtifactManifest {
  return {
    embeddingSync: {
      kind: "metadata",
      data: report as unknown as Record<string, unknown>,
    },
  }
}
