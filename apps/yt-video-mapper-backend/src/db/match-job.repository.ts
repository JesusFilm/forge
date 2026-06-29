import {
  MatchJobStatus as PrismaMatchJobStatus,
  MatchStrength as PrismaMatchStrength,
  type MatchCandidate,
  type MatchJob,
  type PrismaClient,
} from "../generated/prisma/index.js"
import type {
  MatchJobRecord,
  MatchJobRepository,
  MatchJobStatus,
  StoredMatchCandidate,
} from "../services/match-job.service.js"
import type { PublicMatchCandidate } from "../domain/match.js"

export class PrismaMatchJobRepository implements MatchJobRepository {
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
  ): Promise<MatchJobRecord | null> {
    return this.db.$transaction(async (tx) => {
      const candidate = await tx.matchJob.findFirst({
        where: processableWhere(staleStartedBefore),
        orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      })

      if (!candidate) return null

      const claimed = await tx.matchJob.updateMany({
        where: {
          id: candidate.id,
          ...processableWhere(staleStartedBefore),
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

function processableWhere(staleStartedBefore: Date) {
  return {
    OR: [
      { status: PrismaMatchJobStatus.QUEUED },
      {
        status: PrismaMatchJobStatus.RUNNING,
        startedAt: { lte: staleStartedBefore },
      },
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
  } satisfies Record<MatchJobStatus, PrismaMatchJobStatus>

  return map[status]
}

function fromPrismaStatus(status: PrismaMatchJobStatus): MatchJobStatus {
  const map = {
    [PrismaMatchJobStatus.QUEUED]: "queued",
    [PrismaMatchJobStatus.RUNNING]: "running",
    [PrismaMatchJobStatus.COMPLETE]: "complete",
    [PrismaMatchJobStatus.FAILED]: "failed",
  } satisfies Record<PrismaMatchJobStatus, MatchJobStatus>

  return map[status]
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
