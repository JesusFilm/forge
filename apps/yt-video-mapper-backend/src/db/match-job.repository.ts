import {
  MatchJobStatus as PrismaMatchJobStatus,
  MatchStrength as PrismaMatchStrength,
  type MatchCandidate,
  type MatchJob,
  type PrismaClient,
} from "../generated/prisma/index.js"
import type {
  ExpiredUploadCursor,
  ExpireQueuedJobsBatch,
  MatchJobCleanerRepository,
  MatchJobRecord,
  MatchJobRepository,
  MatchJobStatus,
  StoredMatchCandidate,
} from "../services/match-job.service.js"
import { JOB_EXPIRED_ERROR_CODE } from "../services/match-job.service.js"
import type { PublicMatchCandidate } from "../domain/match.js"

const MATCH_JOB_CLEANER_LEASE_NAME = "match_job_cleaner"

export class PrismaMatchJobRepository
  implements MatchJobRepository, MatchJobCleanerRepository
{
  constructor(private readonly db: PrismaClient) {}

  async create(job: MatchJobRecord): Promise<MatchJobRecord> {
    const created = await this.db.matchJob.create({
      data: {
        id: job.id,
        status: toPrismaStatus(job.status),
        uploadStorageKey: job.uploadStorageKey,
        uploadContentType: job.uploadContentType,
        uploadByteLength: job.uploadByteLength,
        resultLimit: job.resultLimit,
        safeErrorCode: job.safeErrorCode,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        failedAt: job.failedAt,
        retentionExpiresAt: job.retentionExpiresAt,
      },
    })

    return fromPrismaJob(created)
  }

  async get(jobId: string): Promise<MatchJobRecord | null> {
    const job = await this.db.matchJob.findUnique({ where: { id: jobId } })
    return job ? fromPrismaJob(job) : null
  }

  async claimQueued(
    jobId: string,
    startedAt: Date,
    staleStartedBefore: Date,
  ): Promise<MatchJobRecord | null> {
    const claimed = await this.db.matchJob.updateMany({
      where: {
        id: jobId,
        OR: [
          { status: PrismaMatchJobStatus.QUEUED },
          {
            status: PrismaMatchJobStatus.RUNNING,
            startedAt: { lte: staleStartedBefore },
          },
        ],
      },
      data: {
        status: PrismaMatchJobStatus.RUNNING,
        startedAt,
        safeErrorCode: null,
      },
    })

    if (claimed.count === 0) return null

    return this.get(jobId)
  }

  async claimNextQueued(
    startedAt: Date,
    staleStartedBefore: Date,
    queuedExpiresAt?: Date,
  ): Promise<MatchJobRecord | null> {
    return this.db.$transaction(async (tx) => {
      const candidate = await tx.matchJob.findFirst({
        where: processableWhere(staleStartedBefore, queuedExpiresAt),
        orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
        select: { id: true },
      })

      if (!candidate) return null

      const claimed = await tx.matchJob.updateMany({
        where: {
          id: candidate.id,
          ...processableWhere(staleStartedBefore, queuedExpiresAt),
        },
        data: {
          status: PrismaMatchJobStatus.RUNNING,
          startedAt,
          safeErrorCode: null,
        },
      })

      if (claimed.count === 0) return null

      const job = await tx.matchJob.findUnique({ where: { id: candidate.id } })
      return job ? fromPrismaJob(job) : null
    })
  }

  async expireQueuedBefore(
    queuedAtOrBefore: Date,
    limit: number,
  ): Promise<ExpireQueuedJobsBatch> {
    return this.db.$transaction(async (tx) => {
      const candidates = await tx.matchJob.findMany({
        where: queuedExpiredWhere(queuedAtOrBefore),
        orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
        take: limit,
        select: { id: true },
      })
      const candidateIds = candidates.map(({ id }) => id)

      if (candidateIds.length === 0) {
        return {
          jobs: [],
          scannedCount: 0,
        }
      }

      await tx.matchJob.updateMany({
        where: {
          id: { in: candidateIds },
          ...queuedExpiredWhere(queuedAtOrBefore),
        },
        data: {
          status: PrismaMatchJobStatus.EXPIRED,
          safeErrorCode: JOB_EXPIRED_ERROR_CODE,
        },
      })

      const expiredJobs = await tx.matchJob.findMany({
        where: {
          id: { in: candidateIds },
          status: PrismaMatchJobStatus.EXPIRED,
          safeErrorCode: JOB_EXPIRED_ERROR_CODE,
        },
        orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      })

      return {
        jobs: expiredJobs.map(fromPrismaJob),
        scannedCount: candidates.length,
      }
    })
  }

  async listExpiredWithUploads(
    limit: number,
    after?: ExpiredUploadCursor,
  ): Promise<MatchJobRecord[]> {
    const jobs = await this.db.matchJob.findMany({
      where: expiredWithUploadsWhere(after),
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      take: limit,
    })

    return jobs.map(fromPrismaJob)
  }

  async clearUploadFields(jobId: string): Promise<void> {
    await this.db.matchJob.updateMany({
      where: {
        id: jobId,
        status: PrismaMatchJobStatus.EXPIRED,
      },
      data: {
        uploadStorageKey: null,
        uploadContentType: null,
        uploadByteLength: null,
      },
    })
  }

  async countExpiredWithUploads(): Promise<number> {
    return this.db.matchJob.count({
      where: expiredWithUploadsWhere(),
    })
  }

  async tryAcquireCleanerLease(
    now: Date,
    lockedUntil: Date,
    ownerToken: string,
  ): Promise<boolean> {
    const refreshed = await this.db.matchJobCleanerLease.updateMany({
      where: {
        name: MATCH_JOB_CLEANER_LEASE_NAME,
        lockedUntil: { lte: now },
      },
      data: { lockedUntil, ownerToken },
    })

    if (refreshed.count > 0) return true

    try {
      await this.db.matchJobCleanerLease.create({
        data: {
          name: MATCH_JOB_CLEANER_LEASE_NAME,
          lockedUntil,
          ownerToken,
        },
      })
      return true
    } catch (error) {
      if (isUniqueConstraintError(error)) return false
      throw error
    }
  }

  async releaseCleanerLease(now: Date, ownerToken: string): Promise<void> {
    await this.db.matchJobCleanerLease.updateMany({
      where: {
        name: MATCH_JOB_CLEANER_LEASE_NAME,
        ownerToken,
        lockedUntil: { gt: now },
      },
      data: { lockedUntil: now },
    })
  }

  async update(
    jobId: string,
    patch: Partial<Omit<MatchJobRecord, "id">>,
  ): Promise<MatchJobRecord> {
    const updated = await this.db.matchJob.update({
      where: { id: jobId },
      data: toPrismaPatch(patch),
    })

    return fromPrismaJob(updated)
  }

  async replaceCandidates(
    jobId: string,
    candidates: PublicMatchCandidate[],
  ): Promise<StoredMatchCandidate[]> {
    await this.db.$transaction(async (tx) => {
      await tx.matchCandidate.deleteMany({ where: { jobId } })

      if (candidates.length === 0) return

      await tx.matchCandidate.createMany({
        data: candidates.map((candidate, index) => ({
          jobId,
          rank: index + 1,
          coreId: candidate.coreId,
          videoVariantId: candidate.videoVariantId,
          confidence: candidate.confidence,
          matchStrength: toPrismaStrength(candidate.matchStrength),
        })),
      })
    })

    return this.listCandidates(jobId)
  }

  async listCandidates(jobId: string): Promise<StoredMatchCandidate[]> {
    const candidates = await this.db.matchCandidate.findMany({
      where: { jobId },
      orderBy: { rank: "asc" },
    })

    return candidates.map(fromPrismaCandidate)
  }
}

function processableWhere(
  staleStartedBefore: Date,
  queuedExpiresAt: Date | undefined,
) {
  return {
    OR: [
      {
        status: PrismaMatchJobStatus.QUEUED,
        ...(queuedExpiresAt ? { queuedAt: { gt: queuedExpiresAt } } : {}),
      },
      {
        status: PrismaMatchJobStatus.RUNNING,
        startedAt: { lte: staleStartedBefore },
      },
    ],
  }
}

function queuedExpiredWhere(queuedAtOrBefore: Date) {
  return {
    status: PrismaMatchJobStatus.QUEUED,
    queuedAt: { lte: queuedAtOrBefore },
  }
}

function expiredWithUploadsWhere(after?: ExpiredUploadCursor) {
  return {
    status: PrismaMatchJobStatus.EXPIRED,
    ...(after
      ? {
          AND: [
            {
              OR: [
                { queuedAt: { gt: after.queuedAt } },
                {
                  queuedAt: after.queuedAt,
                  id: { gt: after.id },
                },
              ],
            },
          ],
        }
      : {}),
    OR: [
      { uploadStorageKey: { not: null } },
      { uploadContentType: { not: null } },
      { uploadByteLength: { not: null } },
    ],
  }
}

function fromPrismaJob(job: MatchJob): MatchJobRecord {
  return {
    id: job.id,
    status: fromPrismaStatus(job.status),
    uploadStorageKey: job.uploadStorageKey ?? undefined,
    uploadContentType: job.uploadContentType ?? undefined,
    uploadByteLength: job.uploadByteLength
      ? Number(job.uploadByteLength)
      : undefined,
    inputDurationMilliseconds: job.inputDurationMilliseconds ?? undefined,
    resultLimit: job.resultLimit,
    safeErrorCode: job.safeErrorCode ?? undefined,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt ?? undefined,
    completedAt: job.completedAt ?? undefined,
    failedAt: job.failedAt ?? undefined,
    retentionExpiresAt: job.retentionExpiresAt ?? undefined,
  }
}

function fromPrismaCandidate(candidate: MatchCandidate): StoredMatchCandidate {
  return {
    rank: candidate.rank,
    coreId: candidate.coreId,
    videoVariantId: candidate.videoVariantId,
    confidence: candidate.confidence,
    matchStrength:
      candidate.matchStrength.toLowerCase() as StoredMatchCandidate["matchStrength"],
  }
}

function toPrismaPatch(patch: Partial<Omit<MatchJobRecord, "id">>) {
  return {
    status: patch.status ? toPrismaStatus(patch.status) : undefined,
    uploadStorageKey: patch.uploadStorageKey,
    uploadContentType: patch.uploadContentType,
    uploadByteLength: patch.uploadByteLength,
    inputDurationMilliseconds: patch.inputDurationMilliseconds,
    resultLimit: patch.resultLimit,
    safeErrorCode: patch.safeErrorCode,
    queuedAt: patch.queuedAt,
    startedAt: patch.startedAt,
    completedAt: patch.completedAt,
    failedAt: patch.failedAt,
    retentionExpiresAt: patch.retentionExpiresAt,
  }
}

function toPrismaStatus(status: MatchJobStatus): PrismaMatchJobStatus {
  const map = {
    queued: PrismaMatchJobStatus.QUEUED,
    running: PrismaMatchJobStatus.RUNNING,
    complete: PrismaMatchJobStatus.COMPLETE,
    failed: PrismaMatchJobStatus.FAILED,
    expired: PrismaMatchJobStatus.EXPIRED,
  } satisfies Record<MatchJobStatus, PrismaMatchJobStatus>

  return map[status]
}

function fromPrismaStatus(status: PrismaMatchJobStatus): MatchJobStatus {
  const map = {
    [PrismaMatchJobStatus.QUEUED]: "queued",
    [PrismaMatchJobStatus.RUNNING]: "running",
    [PrismaMatchJobStatus.COMPLETE]: "complete",
    [PrismaMatchJobStatus.FAILED]: "failed",
    [PrismaMatchJobStatus.EXPIRED]: "expired",
  } satisfies Record<PrismaMatchJobStatus, MatchJobStatus>

  return map[status]
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  )
}

function toPrismaStrength(
  strength: PublicMatchCandidate["matchStrength"],
): PrismaMatchStrength {
  const map = {
    high: PrismaMatchStrength.HIGH,
    medium: PrismaMatchStrength.MEDIUM,
    low: PrismaMatchStrength.LOW,
  } satisfies Record<PublicMatchCandidate["matchStrength"], PrismaMatchStrength>

  return map[strength]
}
