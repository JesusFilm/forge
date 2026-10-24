import {
  fingerprintSubtitleVtt,
  fingerprintSubtitleBytes,
} from "@/lib/subtitle-review-fingerprint"
import {
  buildReviewedSubtitleArtifactKey,
  findExistingSubtitleReviewRevision,
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
import { getJob, compareAndSwapJobArtifacts } from "@/lib/state"
import { parseVTT } from "@/lib/vtt"
import { readArtifactBounded, writeImmutableArtifact } from "@/services/storage"
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
const MAX_EXCHANGE_BUCKETS = 1024
// Rejected keys share fixed hash slots; they can never reserve verified capacity.
const rejectedExchangeAttempts = new Map<
  string,
  { count: number; resetAt: number; requestFingerprint?: string }
>()
const MAX_TRANSITION_ATTEMPTS = 8
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
  | "save_id_conflict"

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
  if (
    Buffer.byteLength(vtt, "utf8") > 512 * 1024 ||
    !/^WEBVTT(?:[ \t][^\n]*)?\r?\n/.test(vtt)
  )
    return false
  const cues = parseVTT(vtt)
  const timingLines = vtt.split("\n").filter((line) => line.includes("-->"))
  return (
    cues.length > 0 &&
    cues.length <= 5000 &&
    cues.length === timingLines.length &&
    timingLines.every((line) =>
      /^\d{2,}:([0-5]\d):([0-5]\d)\.\d{3} --> \d{2,}:([0-5]\d):([0-5]\d)\.\d{3}(?:[ \t].*)?\r?$/.test(
        line,
      ),
    ) &&
    cues.every(
      (cue) =>
        cue.start >= 0 &&
        cue.end > cue.start &&
        cue.end <= 86400 &&
        cue.text.length <= 8192,
    )
  )
}

async function readSubtitleArtifact(
  job: JobRecord,
  artifactKey: string,
): Promise<string | null> {
  if (job.artifacts[artifactKey]?.kind !== "downloadable") {
    return null
  }

  try {
    const bytes = await readArtifactBounded(
      job.muxAssetId,
      artifactKey,
      "vtt",
      512 * 1024,
    )
    const revision = getSubtitleReviewReport(job.artifacts).revisions.find(
      (entry) => entry.artifactKey === artifactKey,
    )
    if (
      revision &&
      fingerprintSubtitleBytes(bytes) !== revision.contentFingerprint
    )
      return null
    return textFromArtifact(bytes)
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

function isExchangeRateLimited(
  buckets: typeof exchangeAttemptsByJob,
  jobId: string,
  nowMs: number,
): boolean {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= nowMs) buckets.delete(key)
  }
  const current = buckets.get(jobId)
  if (!current || current.resetAt <= nowMs) {
    if (buckets.size >= MAX_EXCHANGE_BUCKETS) return true
    buckets.set(jobId, {
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
  const launchCode = createSubtitleReviewLaunchCode()
  for (let attempt = 0; attempt < MAX_TRANSITION_ATTEMPTS; attempt++) {
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
    const baseArtifactKey =
      latestRevision?.artifactKey ?? input.sourceArtifactKey
    const baseVtt = await readSubtitleArtifact(job, baseArtifactKey)
    if (!baseVtt) {
      throw new Error("artifact_not_found")
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + LAUNCH_TTL_MS).toISOString()
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

    if ((nextReport.launchSessions?.length ?? 0) > 64)
      throw new Error("rate_limited")
    const persisted = await compareAndSwapJobArtifacts(
      job,
      withUpdatedReport(job.artifacts, nextReport),
    )
    if (!persisted) continue

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
  throw new Error("persist_failed")
}

export async function exchangeSubtitleReviewLaunchCode(input: {
  jobId: string
  launchCode: string
}): Promise<SubtitleReviewExchangeResult> {
  // Existing verified jobs retain the ten-attempt limit, including bad codes.
  // New keys earn a scarce bucket only after a live, unconsumed launch matches.
  const counted =
    (exchangeAttemptsByJob.get(input.jobId)?.resetAt ?? 0) > Date.now()
  if (
    counted &&
    isExchangeRateLimited(exchangeAttemptsByJob, input.jobId, Date.now())
  )
    return { ok: false, reason: "rate_limited" }
  const slot = String(
    parseInt(fingerprintSubtitleVtt(input.jobId).slice(0, 8), 16) %
      MAX_EXCHANGE_BUCKETS,
  )
  const requestFingerprint = fingerprintSubtitleVtt(
    JSON.stringify([input.jobId, input.launchCode]),
  )
  const rejected = rejectedExchangeAttempts.get(slot)
  // A repeated rejected request can be refused before another job read. Hash
  // collisions alone cannot deny a different (potentially valid) launch.
  if (
    !counted &&
    rejected &&
    rejected.resetAt > Date.now() &&
    rejected.count >= EXCHANGE_RATE_LIMIT_MAX_ATTEMPTS &&
    rejected.requestFingerprint === requestFingerprint
  )
    return { ok: false, reason: "rate_limited" }
  const reject = (
    reason: "job_not_found" | "invalid_launch",
  ): SubtitleReviewFailure => {
    // Collisions may throttle rejected requests, never a valid new capability.
    const limited =
      !counted &&
      isExchangeRateLimited(rejectedExchangeAttempts, slot, Date.now())
    const bucket = rejectedExchangeAttempts.get(slot)
    if (!counted && bucket) bucket.requestFingerprint = requestFingerprint
    return { ok: false, reason: limited ? "rate_limited" : reason }
  }
  let admitted = counted
  for (let attempt = 0; attempt < MAX_TRANSITION_ATTEMPTS; attempt++) {
    const job = await getJob(input.jobId)
    if (!job) {
      return reject("job_not_found")
    }

    const report = getSubtitleReviewReport(job.artifacts)
    const nonceHash = hashSubtitleReviewLaunchCode(input.launchCode)
    const now = new Date()
    const session = (report.launchSessions ?? []).find(
      (candidate) => candidate.nonceHash === nonceHash,
    )
    if (
      !session ||
      session.consumedAt ||
      Date.parse(session.expiresAt) <= now.getTime()
    ) {
      return reject("invalid_launch")
    }
    if (!admitted) {
      if (isExchangeRateLimited(exchangeAttemptsByJob, input.jobId, Date.now()))
        return { ok: false, reason: "rate_limited" }
      admitted = true
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

    const persisted = await compareAndSwapJobArtifacts(
      job,
      withUpdatedReport(job.artifacts, nextReport),
    )
    if (!persisted) continue

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
  return { ok: false, reason: "persist_failed" }
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
    baseFingerprint: latestRevision
      ? baseFingerprint
      : fingerprintSubtitleVtt(vtt),
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

  if (
    !input.clientSaveId ||
    input.clientSaveId.length > 128 ||
    !isUsableReviewVtt(input.vtt)
  ) {
    return { ok: false, reason: "invalid_vtt" }
  }

  for (let attempt = 0; attempt < MAX_TRANSITION_ATTEMPTS; attempt++) {
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
    if (
      existingRevision &&
      (existingRevision.sourceArtifactKey !== token.sourceArtifactKey ||
        existingRevision.contentFingerprint !== contentFingerprint ||
        existingRevision.baseFingerprint !== baseArtifactFingerprint ||
        existingRevision.actorId !== token.actorId ||
        existingRevision.targetLanguage !== token.targetLanguage ||
        existingRevision.sessionFingerprint !==
          fingerprintSubtitleVtt(input.editToken))
    ) {
      return { ok: false, reason: "save_id_conflict" }
    }
    if (existingRevision) {
      if (!(await readSubtitleArtifact(job, existingRevision.artifactKey)))
        return { ok: false, reason: "persist_failed" }
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

    if (report.revisions.length >= 5000)
      return { ok: false, reason: "rate_limited" }
    const latestRevision = getLatestSubtitleReviewRevision(
      job.artifacts,
      token.sourceArtifactKey,
    )
    const baseVtt = await readSubtitleArtifact(
      job,
      latestRevision?.artifactKey ?? token.sourceArtifactKey,
    )
    if (!baseVtt) return { ok: false, reason: "artifact_not_found" }
    if (fingerprintSubtitleVtt(baseVtt) !== baseArtifactFingerprint) {
      return {
        ok: false,
        reason: "stale_base",
        latestArtifactKey: latestRevision?.artifactKey,
      }
    }

    const revision =
      report.revisions
        .filter((entry) => entry.sourceArtifactKey === token.sourceArtifactKey)
        .reduce((highest, entry) => Math.max(highest, entry.revision), 0) + 1
    const artifactKey = buildReviewedSubtitleArtifactKey(
      token.targetLanguage,
      revision,
      fingerprintSubtitleVtt(input.jobId),
      fingerprintSubtitleVtt(
        JSON.stringify([
          token.sourceArtifactKey,
          token.actorId,
          input.editToken,
          baseArtifactFingerprint,
          input.clientSaveId,
          contentFingerprint,
        ]),
      ),
    )

    try {
      await writeImmutableArtifact({
        assetId: job.muxAssetId,
        artifactType: artifactKey,
        ext: "vtt",
        body: input.vtt,
        contentType: "text/vtt; charset=utf-8",
      })
    } catch {
      return { ok: false, reason: "persist_failed" }
    }

    const now = new Date().toISOString()
    const nextRevision: SubtitleReviewRevision = {
      artifactKey,
      sourceArtifactKey: token.sourceArtifactKey,
      targetLanguage: token.targetLanguage,
      revision,
      baseFingerprint: baseArtifactFingerprint,
      contentFingerprint,
      clientSaveId: input.clientSaveId,
      sessionFingerprint: fingerprintSubtitleVtt(input.editToken),
      actorId: token.actorId,
      createdAt: now,
    }
    const nextReport: SubtitleReviewReport = {
      ...report,
      revisions: [...report.revisions, nextRevision],
      launchSessions: report.launchSessions ?? [],
      updatedAt: now,
    }

    let persisted = false
    try {
      persisted = await compareAndSwapJobArtifacts(job, {
        ...withUpdatedReport(job.artifacts, nextReport),
        [artifactKey]: { kind: "downloadable" },
      })
    } catch {
      // A transport failure can follow a committed write. Re-read, then the
      // equality-only replay path reconciles it without overwriting any object.
      continue
    }
    if (!persisted) continue

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
  return { ok: false, reason: "persist_failed" }
}
