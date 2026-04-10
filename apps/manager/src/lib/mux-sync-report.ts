import type {
  JobArtifactManifest,
  MuxSyncComparison,
  MuxSyncOverrideAuditEntry,
  MuxSyncReport,
  MuxSyncStatus,
} from "@/types/job"

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function isMuxSyncStatus(value: unknown): value is MuxSyncStatus {
  return (
    value === "synced" ||
    value === "skipped_existing_mux_data" ||
    value === "skipped_missing_generated_data" ||
    value === "override_applied" ||
    value === "failed"
  )
}

function normalizeMuxSyncComparison(raw: unknown): MuxSyncComparison | null {
  if (!isObjectRecord(raw)) {
    return null
  }

  const artifactKey =
    typeof raw.artifactKey === "string" ? raw.artifactKey : null
  const targetLanguage =
    typeof raw.targetLanguage === "string" ? raw.targetLanguage : null
  const muxTargetType = raw.muxTargetType === "text_track" ? "text_track" : null
  const muxTargetKey =
    typeof raw.muxTargetKey === "string" ? raw.muxTargetKey : null
  const status = isMuxSyncStatus(raw.status) ? raw.status : null
  const explanation =
    typeof raw.explanation === "string" ? raw.explanation : null

  if (
    artifactKey == null ||
    targetLanguage == null ||
    muxTargetType == null ||
    muxTargetKey == null ||
    status == null ||
    explanation == null
  ) {
    return null
  }

  return {
    artifactKey,
    targetLanguage,
    muxTargetType,
    muxTargetKey,
    status,
    explanation,
    generatedPreview:
      typeof raw.generatedPreview === "string"
        ? raw.generatedPreview
        : undefined,
    muxPreview: typeof raw.muxPreview === "string" ? raw.muxPreview : undefined,
    muxTrackId: typeof raw.muxTrackId === "string" ? raw.muxTrackId : undefined,
    canOverride:
      typeof raw.canOverride === "boolean" ? raw.canOverride : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  }
}

function normalizeOverrideAuditEntry(
  raw: unknown,
): MuxSyncOverrideAuditEntry | null {
  if (!isObjectRecord(raw)) {
    return null
  }

  if (
    typeof raw.artifactKey !== "string" ||
    typeof raw.targetLanguage !== "string" ||
    typeof raw.at !== "string" ||
    raw.action !== "override_subtitle_track"
  ) {
    return null
  }

  return {
    artifactKey: raw.artifactKey,
    targetLanguage: raw.targetLanguage,
    at: raw.at,
    action: "override_subtitle_track",
  }
}

export function getMuxSyncReport(
  artifacts: JobArtifactManifest,
): MuxSyncReport | undefined {
  const raw = artifacts.muxSync
  if (!raw || raw.kind !== "metadata" || !isObjectRecord(raw.data)) {
    return undefined
  }

  const comparisons = Array.isArray(raw.data.comparisons)
    ? raw.data.comparisons
        .map(normalizeMuxSyncComparison)
        .filter((entry): entry is MuxSyncComparison => entry != null)
    : []

  if (comparisons.length === 0) {
    return undefined
  }

  const overrideHistory = Array.isArray(raw.data.overrideHistory)
    ? raw.data.overrideHistory
        .map(normalizeOverrideAuditEntry)
        .filter((entry): entry is MuxSyncOverrideAuditEntry => entry != null)
    : []

  return {
    comparisons,
    overrideHistory,
    updatedAt:
      typeof raw.data.updatedAt === "string"
        ? raw.data.updatedAt
        : new Date(0).toISOString(),
  }
}

export function setMuxSyncReport(
  artifacts: JobArtifactManifest,
  report: MuxSyncReport,
): JobArtifactManifest {
  return {
    ...artifacts,
    muxSync: {
      kind: "metadata",
      data: report as unknown as Record<string, unknown>,
    },
  }
}
