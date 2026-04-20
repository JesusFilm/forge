import { createHash } from "node:crypto"
import type {
  JobArtifactManifest,
  SubtitleReviewLaunchSession,
  SubtitleReviewReport,
  SubtitleReviewRevision,
} from "@/types/job"

const EMPTY_UPDATED_AT = new Date(0).toISOString()

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function normalizeRevision(raw: unknown): SubtitleReviewRevision | null {
  if (!isObjectRecord(raw)) {
    return null
  }

  if (
    typeof raw.artifactKey !== "string" ||
    typeof raw.sourceArtifactKey !== "string" ||
    typeof raw.targetLanguage !== "string" ||
    typeof raw.revision !== "number" ||
    !Number.isInteger(raw.revision) ||
    typeof raw.baseFingerprint !== "string" ||
    typeof raw.contentFingerprint !== "string" ||
    typeof raw.clientSaveId !== "string" ||
    typeof raw.actorId !== "string" ||
    typeof raw.createdAt !== "string"
  ) {
    return null
  }

  return {
    artifactKey: raw.artifactKey,
    sourceArtifactKey: raw.sourceArtifactKey,
    targetLanguage: raw.targetLanguage,
    revision: raw.revision,
    baseFingerprint: raw.baseFingerprint,
    contentFingerprint: raw.contentFingerprint,
    clientSaveId: raw.clientSaveId,
    actorId: raw.actorId,
    createdAt: raw.createdAt,
  }
}

function normalizeLaunchSession(
  raw: unknown,
): SubtitleReviewLaunchSession | null {
  if (!isObjectRecord(raw)) {
    return null
  }

  if (
    typeof raw.nonceHash !== "string" ||
    typeof raw.sourceArtifactKey !== "string" ||
    typeof raw.targetLanguage !== "string" ||
    typeof raw.baseArtifactKey !== "string" ||
    typeof raw.baseFingerprint !== "string" ||
    typeof raw.actorId !== "string" ||
    typeof raw.createdAt !== "string" ||
    typeof raw.expiresAt !== "string"
  ) {
    return null
  }

  return {
    nonceHash: raw.nonceHash,
    sourceArtifactKey: raw.sourceArtifactKey,
    targetLanguage: raw.targetLanguage,
    baseArtifactKey: raw.baseArtifactKey,
    baseFingerprint: raw.baseFingerprint,
    actorId: raw.actorId,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    consumedAt: typeof raw.consumedAt === "string" ? raw.consumedAt : undefined,
  }
}

export function buildReviewedSubtitleArtifactKey(
  targetLanguage: string,
  revision: number,
): string {
  return `subtitles-${targetLanguage}-reviewed-r${String(revision).padStart(
    4,
    "0",
  )}`
}

export function isReviewedSubtitleArtifactKey(logicalKey: string): boolean {
  return /^subtitles-.+-reviewed-r\d{4}$/.test(logicalKey)
}

export function fingerprintSubtitleVtt(vtt: string): string {
  return createHash("sha256").update(vtt, "utf8").digest("hex")
}

export function getSubtitleReviewReport(
  artifacts: JobArtifactManifest,
): SubtitleReviewReport {
  const raw = artifacts.subtitleReviews
  if (!raw || raw.kind !== "metadata" || !isObjectRecord(raw.data)) {
    return {
      revisions: [],
      launchSessions: [],
      updatedAt: EMPTY_UPDATED_AT,
    }
  }

  const revisions = Array.isArray(raw.data.revisions)
    ? raw.data.revisions
        .map(normalizeRevision)
        .filter((entry): entry is SubtitleReviewRevision => entry != null)
    : []
  const launchSessions = Array.isArray(raw.data.launchSessions)
    ? raw.data.launchSessions
        .map(normalizeLaunchSession)
        .filter((entry): entry is SubtitleReviewLaunchSession => entry != null)
    : []

  return {
    revisions,
    launchSessions,
    updatedAt:
      typeof raw.data.updatedAt === "string"
        ? raw.data.updatedAt
        : EMPTY_UPDATED_AT,
  }
}

export function setSubtitleReviewReport(
  artifacts: JobArtifactManifest,
  report: SubtitleReviewReport,
): JobArtifactManifest {
  return {
    ...artifacts,
    subtitleReviews: {
      kind: "metadata",
      data: report as unknown as Record<string, unknown>,
    },
  }
}

export function getLatestSubtitleReviewRevision(
  artifacts: JobArtifactManifest,
  sourceArtifactKey: string,
): SubtitleReviewRevision | undefined {
  return getSubtitleReviewReport(artifacts)
    .revisions.filter(
      (revision) => revision.sourceArtifactKey === sourceArtifactKey,
    )
    .sort((left, right) => right.revision - left.revision)[0]
}

export function findExistingSubtitleReviewRevision(
  report: SubtitleReviewReport,
  input: {
    sourceArtifactKey: string
    clientSaveId: string
    contentFingerprint: string
  },
): SubtitleReviewRevision | undefined {
  return report.revisions.find(
    (revision) =>
      revision.sourceArtifactKey === input.sourceArtifactKey &&
      (revision.clientSaveId === input.clientSaveId ||
        revision.contentFingerprint === input.contentFingerprint),
  )
}
