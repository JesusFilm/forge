import {
  buildReviewedSubtitleArtifactKey,
  findExistingSubtitleReviewRevision,
  fingerprintSubtitleVtt,
  getLatestSubtitleReviewRevision,
  getSubtitleReviewReport,
  isReviewedSubtitleArtifactKey,
  setSubtitleReviewReport,
} from "@/lib/subtitle-review"
import {
  buildSubtitleEditorLaunchUrl,
  createSubtitleReviewLaunchCode,
  hashSubtitleReviewLaunchCode,
  signSubtitleReviewToken,
  verifySubtitleReviewToken,
} from "@/lib/subtitle-review-session"
import { getJob, updateJob } from "@/lib/state"
import { parseVTT } from "@/lib/vtt"
import { readArtifact, writeArtifact } from "@/services/storage"
import type {
  JobArtifactManifest,
  JobRecord,
  SubtitleReviewLaunchSession,
  SubtitleReviewReport,
  SubtitleReviewRevision,
} from "@/types/job"

const LAUNCH_TTL_MS = 5 * 60 * 1000
const EDIT_TOKEN_TTL_MS = 30 * 60 * 1000
const EXCHANGE_RATE_LIMIT_WINDOW_MS = 60 * 1000
const EXCHANGE_RATE_LIMIT_MAX_ATTEMPTS = 10
const exchangeAttemptsByJob = new Map<
  string,
  {
    count: number
    resetAt: number
  }
>()

export type SubtitleReviewFailureReason =
  | "job_not_found"
  | "artifact_not_found"
  | "invalid_artifact"
  | "invalid_launch"
  | "invalid_token"
  | "missing_playback"
  | "invalid_vtt"
  | "rate_limited"
  | "stale_base"
  | "persist_failed"

export type SubtitleReviewFailure = {
  ok: false
  reason: SubtitleReviewFailureReason
}

export type SubtitleReviewExchangeResult =
  | {
      ok: true
      editToken: string
      expiresAt: string
      sourceArtifactKey: string
      targetLanguage: string
      baseArtifactKey: string
      baseFingerprint: string
    }
  | SubtitleReviewFailure

export type SubtitleReviewBootstrapResult =
  | {
      ok: true
      jobId: string
      sourceArtifactKey: string
      targetLanguage: string
      baseArtifactKey: string
      baseFingerprint: string
      vtt: string
      media: {
        muxPlaybackId: string
        muxAssetId: string
      }
      returnUrl: string
    }
  | SubtitleReviewFailure

export type SubtitleReviewSaveResult =
  | {
      ok: true
      status: "saved" | "duplicate"
      jobId: string
      artifactKey: string
      reviewedArtifactKey: string
      revision: number
      contentFingerprint: string
      baseArtifactFingerprint: string
      savedAt: string
    }
  | (SubtitleReviewFailure & {
      latestArtifactKey?: string
    })

type CreateSubtitleReviewSessionInput = {
  jobId: string
  sourceArtifactKey: string
  actorId: string
}

type CreateSubtitleReviewSessionResult = {
  editorUrl: string
  sourceArtifactKey: string
  targetLanguage: string
  baseArtifactKey: string
  baseFingerprint: string
  expiresAt: string
}

function targetLanguageFromSubtitleArtifact(sourceArtifactKey: string): string {
  if (
    !sourceArtifactKey.startsWith("subtitles-") ||
    isReviewedSubtitleArtifactKey(sourceArtifactKey)
  ) {
    throw new Error("invalid_artifact")
  }

  return sourceArtifactKey.slice("subtitles-".length)
}

function textFromArtifact(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8")
}

function isUsableReviewVtt(vtt: string): boolean {
  return vtt.trimStart().startsWith("WEBVTT") && parseVTT(vtt).length > 0
}

async function readSubtitleArtifact(
  job: JobRecord,
  artifactKey: string,
): Promise<string | null> {
  if (job.artifacts[artifactKey]?.kind !== "downloadable") {
    return null
  }

  try {
    return textFromArtifact(
      await readArtifact(job.muxAssetId, artifactKey, "vtt"),
    )
  } catch {
    return null
  }
}

function pruneLaunchSessions(
  sessions: SubtitleReviewLaunchSession[],
  now: Date,
): SubtitleReviewLaunchSession[] {
  return sessions.filter(
    (session) => Date.parse(session.expiresAt) > now.getTime(),
  )
}

function withUpdatedReport(
  artifacts: JobArtifactManifest,
  report: SubtitleReviewReport,
): JobArtifactManifest {
  return setSubtitleReviewReport(artifacts, {
    ...report,
    launchSessions: report.launchSessions ?? [],
  })
}

async function persistArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<boolean> {
  return (await updateJob(jobId, { artifacts })) != null
}

function isExchangeRateLimited(jobId: string, nowMs: number): boolean {
  const current = exchangeAttemptsByJob.get(jobId)
  if (!current || current.resetAt <= nowMs) {
    exchangeAttemptsByJob.set(jobId, {
      count: 1,
      resetAt: nowMs + EXCHANGE_RATE_LIMIT_WINDOW_MS,
    })
    return false
  }

  current.count += 1
  return current.count > EXCHANGE_RATE_LIMIT_MAX_ATTEMPTS
}

export async function createSubtitleReviewSession(
  input: CreateSubtitleReviewSessionInput,
): Promise<CreateSubtitleReviewSessionResult> {
  const job = await getJob(input.jobId)
  if (!job) {
    throw new Error("job_not_found")
  }

  const targetLanguage = targetLanguageFromSubtitleArtifact(
    input.sourceArtifactKey,
  )
  const report = getSubtitleReviewReport(job.artifacts)
  const latestRevision = getLatestSubtitleReviewRevision(
    job.artifacts,
    input.sourceArtifactKey,
  )
  const baseArtifactKey = latestRevision?.artifactKey ?? input.sourceArtifactKey
  const baseVtt = await readSubtitleArtifact(job, baseArtifactKey)
  if (!baseVtt) {
    throw new Error("artifact_not_found")
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + LAUNCH_TTL_MS).toISOString()
  const launchCode = createSubtitleReviewLaunchCode()
  const launchSession: SubtitleReviewLaunchSession = {
    nonceHash: hashSubtitleReviewLaunchCode(launchCode),
    sourceArtifactKey: input.sourceArtifactKey,
    targetLanguage,
    baseArtifactKey,
    baseFingerprint:
      latestRevision?.contentFingerprint ?? fingerprintSubtitleVtt(baseVtt),
    actorId: input.actorId,
    createdAt: now.toISOString(),
    expiresAt,
  }

  const nextReport: SubtitleReviewReport = {
    ...report,
    launchSessions: [
      ...pruneLaunchSessions(report.launchSessions ?? [], now),
      launchSession,
    ],
    updatedAt: now.toISOString(),
  }

  const persisted = await persistArtifacts(
    input.jobId,
    withUpdatedReport(job.artifacts, nextReport),
  )
  if (!persisted) {
    throw new Error("persist_failed")
  }

  return {
    editorUrl: buildSubtitleEditorLaunchUrl({
      jobId: input.jobId,
      launchCode,
    }),
    sourceArtifactKey: input.sourceArtifactKey,
    targetLanguage,
    baseArtifactKey,
    baseFingerprint: launchSession.baseFingerprint,
    expiresAt,
  }
}

export async function exchangeSubtitleReviewLaunchCode(input: {
  jobId: string
  launchCode: string
}): Promise<SubtitleReviewExchangeResult> {
  const job = await getJob(input.jobId)
  if (!job) {
    return { ok: false, reason: "job_not_found" }
  }

  const report = getSubtitleReviewReport(job.artifacts)
  const nonceHash = hashSubtitleReviewLaunchCode(input.launchCode)
  const now = new Date()
  if (isExchangeRateLimited(input.jobId, now.getTime())) {
    return { ok: false, reason: "rate_limited" }
  }
  const session = (report.launchSessions ?? []).find(
    (candidate) => candidate.nonceHash === nonceHash,
  )
  if (
    !session ||
    session.consumedAt ||
    Date.parse(session.expiresAt) <= now.getTime()
  ) {
    return { ok: false, reason: "invalid_launch" }
  }

  const consumedAt = now.toISOString()
  const nextReport: SubtitleReviewReport = {
    ...report,
    launchSessions: (report.launchSessions ?? []).map((candidate) =>
      candidate.nonceHash === nonceHash
        ? { ...candidate, consumedAt }
        : candidate,
    ),
    updatedAt: consumedAt,
  }

  const persisted = await persistArtifacts(
    input.jobId,
    withUpdatedReport(job.artifacts, nextReport),
  )
  if (!persisted) {
    return { ok: false, reason: "persist_failed" }
  }

  const expiresAt = new Date(now.getTime() + EDIT_TOKEN_TTL_MS).toISOString()
  return {
    ok: true,
    editToken: await signSubtitleReviewToken({
      jobId: input.jobId,
      sourceArtifactKey: session.sourceArtifactKey,
      targetLanguage: session.targetLanguage,
      baseArtifactKey: session.baseArtifactKey,
      baseFingerprint: session.baseFingerprint,
      actorId: session.actorId,
      expiresAt,
    }),
    expiresAt,
    sourceArtifactKey: session.sourceArtifactKey,
    targetLanguage: session.targetLanguage,
    baseArtifactKey: session.baseArtifactKey,
    baseFingerprint: session.baseFingerprint,
  }
}

export async function bootstrapSubtitleReviewSession(input: {
  jobId: string
  editToken: string
}): Promise<SubtitleReviewBootstrapResult> {
  const token = await verifySubtitleReviewToken(input.editToken)
  if (!token || token.jobId !== input.jobId) {
    return { ok: false, reason: "invalid_token" }
  }

  const job = await getJob(input.jobId)
  if (!job) {
    return { ok: false, reason: "job_not_found" }
  }

  if (!job.muxPlaybackId) {
    return { ok: false, reason: "missing_playback" }
  }

  const latestRevision = getLatestSubtitleReviewRevision(
    job.artifacts,
    token.sourceArtifactKey,
  )
  const baseArtifactKey = latestRevision?.artifactKey ?? token.baseArtifactKey
  const baseFingerprint =
    latestRevision?.contentFingerprint ?? token.baseFingerprint
  const vtt = await readSubtitleArtifact(job, baseArtifactKey)
  if (!vtt) {
    return { ok: false, reason: "artifact_not_found" }
  }

  return {
    ok: true,
    jobId: input.jobId,
    sourceArtifactKey: token.sourceArtifactKey,
    targetLanguage: token.targetLanguage,
    baseArtifactKey,
    baseFingerprint,
    vtt,
    media: {
      muxPlaybackId: job.muxPlaybackId,
      muxAssetId: job.muxAssetId,
    },
    returnUrl: `/dashboard/jobs/${encodeURIComponent(input.jobId)}`,
  }
}

export async function saveSubtitleReviewRevision(input: {
  jobId: string
  editToken: string
  vtt: string
  clientSaveId: string
  baseArtifactFingerprint?: string
}): Promise<SubtitleReviewSaveResult> {
  const token = await verifySubtitleReviewToken(input.editToken)
  if (!token || token.jobId !== input.jobId) {
    return { ok: false, reason: "invalid_token" }
  }

  if (!isUsableReviewVtt(input.vtt)) {
    return { ok: false, reason: "invalid_vtt" }
  }

  const job = await getJob(input.jobId)
  if (!job) {
    return { ok: false, reason: "job_not_found" }
  }

  const report = getSubtitleReviewReport(job.artifacts)
  const contentFingerprint = fingerprintSubtitleVtt(input.vtt)
  const baseArtifactFingerprint =
    input.baseArtifactFingerprint ?? token.baseFingerprint
  const existingRevision = findExistingSubtitleReviewRevision(report, {
    sourceArtifactKey: token.sourceArtifactKey,
    clientSaveId: input.clientSaveId,
    contentFingerprint,
  })
  if (existingRevision) {
    return {
      ok: true,
      status: "duplicate",
      jobId: input.jobId,
      artifactKey: existingRevision.artifactKey,
      reviewedArtifactKey: existingRevision.artifactKey,
      revision: existingRevision.revision,
      contentFingerprint: existingRevision.contentFingerprint,
      baseArtifactFingerprint: existingRevision.baseFingerprint,
      savedAt: existingRevision.createdAt,
    }
  }

  const latestRevision = getLatestSubtitleReviewRevision(
    job.artifacts,
    token.sourceArtifactKey,
  )
  if (
    latestRevision &&
    latestRevision.contentFingerprint !== baseArtifactFingerprint
  ) {
    return {
      ok: false,
      reason: "stale_base",
      latestArtifactKey: latestRevision.artifactKey,
    }
  }

  const revision =
    report.revisions
      .filter((entry) => entry.sourceArtifactKey === token.sourceArtifactKey)
      .reduce((highest, entry) => Math.max(highest, entry.revision), 0) + 1
  const artifactKey = buildReviewedSubtitleArtifactKey(
    token.targetLanguage,
    revision,
  )

  await writeArtifact({
    assetId: job.muxAssetId,
    artifactType: artifactKey,
    ext: "vtt",
    body: input.vtt,
    contentType: "text/vtt; charset=utf-8",
  })

  const now = new Date().toISOString()
  const nextRevision: SubtitleReviewRevision = {
    artifactKey,
    sourceArtifactKey: token.sourceArtifactKey,
    targetLanguage: token.targetLanguage,
    revision,
    baseFingerprint: baseArtifactFingerprint,
    contentFingerprint,
    clientSaveId: input.clientSaveId,
    actorId: token.actorId,
    createdAt: now,
  }
  const nextReport: SubtitleReviewReport = {
    ...report,
    revisions: [...report.revisions, nextRevision],
    launchSessions: report.launchSessions ?? [],
    updatedAt: now,
  }

  const persisted = await persistArtifacts(input.jobId, {
    ...withUpdatedReport(job.artifacts, nextReport),
    [artifactKey]: { kind: "downloadable" },
  })
  if (!persisted) {
    return { ok: false, reason: "persist_failed" }
  }

  return {
    ok: true,
    status: "saved",
    jobId: input.jobId,
    artifactKey,
    reviewedArtifactKey: artifactKey,
    revision,
    contentFingerprint,
    baseArtifactFingerprint,
    savedAt: now,
  }
}
