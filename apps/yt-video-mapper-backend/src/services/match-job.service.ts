import { randomUUID } from "node:crypto"
import { env } from "../config/env.js"
import type { PublicMatchCandidate } from "../domain/match.js"
import type {
  UploadSignalExtractor,
  UploadSignals,
} from "./upload-signal-extraction.js"
import type { UploadStorage } from "./upload-storage.js"

export const JOB_EXPIRED_ERROR_CODE = "job_expired"
export const QUEUED_JOB_EXPIRY_MINUTES = 30
export const MATCH_JOB_CLEANER_INTERVAL_MS = 60_000
export const MATCH_JOB_CLEANER_PAGE_SIZE = 100
export const MATCH_JOB_CLEANER_LEASE_MINUTES = 30
export const MATCH_JOB_EXPIRED_UPLOAD_RETRY_PAGES_PER_TICK = 1

export type MatchJobStatus =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "expired"

export type MatchJobRecord = {
  id: string
  status: MatchJobStatus
  uploadStorageKey?: string
  uploadContentType?: string
  uploadByteLength?: number
  inputDurationMilliseconds?: number
  resultLimit: number
  safeErrorCode?: string
  queuedAt: Date
  startedAt?: Date
  completedAt?: Date
  failedAt?: Date
  retentionExpiresAt?: Date
}

export type StoredMatchCandidate = PublicMatchCandidate & {
  rank: number
}

export type CreateUploadJobInput = {
  bytes: Buffer
  contentType: string
  resultLimit?: number
}

export type MatchJobResult =
  | {
      jobId: string
      status: Exclude<MatchJobStatus, "complete">
      errorCode?: string
    }
  | {
      candidates: PublicMatchCandidate[]
    }

export type ExpireQueuedJobsBatch = {
  jobs: MatchJobRecord[]
  scannedCount: number
}

export type ExpiredUploadCursor = {
  queuedAt: Date
  id: string
}

export type MatchJobCleanerSummary = {
  expiredJobs: number
  uploadCleanupSucceeded: number
  uploadCleanupFailed: number
  expiredUploadRetries: number
  remainingExpiredUploads: number
  skippedDueToLock: boolean
}

export type MatchJobRepository = {
  create(job: MatchJobRecord): Promise<MatchJobRecord>
  get(jobId: string): Promise<MatchJobRecord | null>
  claimQueued(
    jobId: string,
    startedAt: Date,
    staleStartedBefore: Date,
  ): Promise<MatchJobRecord | null>
  claimNextQueued(
    startedAt: Date,
    staleStartedBefore: Date,
    queuedExpiresAt?: Date,
  ): Promise<MatchJobRecord | null>
  update(
    jobId: string,
    patch: Partial<Omit<MatchJobRecord, "id">>,
  ): Promise<MatchJobRecord>
  replaceCandidates(
    jobId: string,
    candidates: PublicMatchCandidate[],
  ): Promise<StoredMatchCandidate[]>
  listCandidates(jobId: string): Promise<StoredMatchCandidate[]>
}

export type MatchJobCleanerRepository = {
  expireQueuedBefore(
    queuedAtOrBefore: Date,
    limit: number,
  ): Promise<ExpireQueuedJobsBatch>
  listExpiredWithUploads(
    limit: number,
    after?: ExpiredUploadCursor,
  ): Promise<MatchJobRecord[]>
  clearUploadFields(jobId: string): Promise<void>
  countExpiredWithUploads(): Promise<number>
  tryAcquireCleanerLease(
    now: Date,
    lockedUntil: Date,
    ownerToken: string,
  ): Promise<boolean>
  releaseCleanerLease(now: Date, ownerToken: string): Promise<void>
}

export type Matcher = {
  match(
    signals: UploadSignals,
    options: { limit: number },
  ): Promise<PublicMatchCandidate[]>
}

export class SafeMatchJobError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export class MatchJobService {
  private readonly cleanerRepository: MatchJobCleanerRepository | undefined

  constructor(
    private readonly repository: MatchJobRepository,
    private readonly storage: UploadStorage,
    private readonly extractor: UploadSignalExtractor,
    private readonly matcher: Matcher,
    private readonly now: () => Date = () => new Date(),
    cleanerRepository?: MatchJobCleanerRepository,
  ) {
    this.cleanerRepository =
      cleanerRepository ?? asMatchJobCleanerRepository(repository)
  }

  async createUploadJob({
    bytes,
    contentType,
    resultLimit = env.MATCH_RESULT_LIMIT,
  }: CreateUploadJobInput): Promise<MatchJobRecord> {
    if (bytes.byteLength === 0) {
      throw new SafeMatchJobError("empty_upload")
    }

    const storedUpload = await this.storage.put({ bytes, contentType })
    const queuedAt = this.now()

    try {
      return await this.repository.create({
        id: randomUUID(),
        status: "queued",
        uploadStorageKey: storedUpload.key,
        uploadContentType: storedUpload.contentType,
        uploadByteLength: storedUpload.byteLength,
        resultLimit,
        queuedAt,
        retentionExpiresAt: addHours(queuedAt, env.JOB_RESULT_RETENTION_HOURS),
      })
    } catch (error) {
      await cleanupStoredUpload(this.storage, storedUpload.key)
      throw error
    }
  }

  async processJob(jobId: string): Promise<void> {
    const existingJob = await this.repository.get(jobId)
    if (!existingJob) throw new SafeMatchJobError("job_not_found")
    if (isTerminalJob(existingJob)) {
      return
    }

    const startedAt = this.now()
    const job = await this.repository.claimQueued(
      jobId,
      startedAt,
      addMinutes(startedAt, -env.JOB_RUNNING_STALE_MINUTES),
    )
    if (!job) return

    await this.processClaimedJob(job)
  }

  async processNextJob(): Promise<MatchJobRecord | null> {
    const startedAt = this.now()
    const job = await this.repository.claimNextQueued(
      startedAt,
      addMinutes(startedAt, -env.JOB_RUNNING_STALE_MINUTES),
      addMinutes(startedAt, -QUEUED_JOB_EXPIRY_MINUTES),
    )
    if (!job) return null

    await this.processClaimedJob(job)
    return job
  }

  async cleanExpiredQueuedJobs({
    pageSize = MATCH_JOB_CLEANER_PAGE_SIZE,
  }: {
    pageSize?: number
  } = {}): Promise<MatchJobCleanerSummary> {
    const cleanerRepository = this.requireCleanerRepository()
    const lockNow = this.now()
    const ownerToken = randomUUID()
    const acquired = await cleanerRepository.tryAcquireCleanerLease(
      lockNow,
      addMinutes(lockNow, MATCH_JOB_CLEANER_LEASE_MINUTES),
      ownerToken,
    )

    if (!acquired) {
      return emptyCleanerSummary({ skippedDueToLock: true })
    }

    try {
      return await this.cleanExpiredQueuedJobsWithoutLock(pageSize)
    } finally {
      await cleanerRepository
        .releaseCleanerLease(this.now(), ownerToken)
        .catch(() => {
          // The lease expires on its own if release fails.
        })
    }
  }

  private async cleanExpiredQueuedJobsWithoutLock(
    pageSize: number,
  ): Promise<MatchJobCleanerSummary> {
    const cleanerRepository = this.requireCleanerRepository()
    const summary = emptyCleanerSummary()
    const cutoff = addMinutes(this.now(), -QUEUED_JOB_EXPIRY_MINUTES)

    await this.retryExpiredUploadCleanup(
      pageSize,
      MATCH_JOB_EXPIRED_UPLOAD_RETRY_PAGES_PER_TICK,
      summary,
    )

    while (true) {
      const batch = await cleanerRepository.expireQueuedBefore(cutoff, pageSize)
      summary.expiredJobs += batch.jobs.length

      await this.cleanupExpiredUploads(batch.jobs, summary)

      if (batch.scannedCount < pageSize) break
    }

    summary.remainingExpiredUploads =
      await cleanerRepository.countExpiredWithUploads()
    return summary
  }

  private async retryExpiredUploadCleanup(
    pageSize: number,
    maxPages: number,
    summary: MatchJobCleanerSummary,
  ): Promise<void> {
    const cleanerRepository = this.requireCleanerRepository()
    let cursor: ExpiredUploadCursor | undefined
    let pages = 0

    while (pages < maxPages) {
      const jobs = await cleanerRepository.listExpiredWithUploads(
        pageSize,
        cursor,
      )
      if (jobs.length === 0) break

      pages += 1
      summary.expiredUploadRetries += jobs.length
      cursor = toExpiredUploadCursor(jobs[jobs.length - 1]!)

      await this.cleanupExpiredUploads(jobs, summary)

      if (jobs.length < pageSize) break
    }
  }

  private async cleanupExpiredUploads(
    jobs: MatchJobRecord[],
    summary: MatchJobCleanerSummary,
  ): Promise<void> {
    const cleanerRepository = this.requireCleanerRepository()
    for (const job of jobs) {
      try {
        if (job.uploadStorageKey) {
          await this.storage.remove(job.uploadStorageKey)
        }

        await cleanerRepository.clearUploadFields(job.id)
        summary.uploadCleanupSucceeded += 1
      } catch {
        summary.uploadCleanupFailed += 1
      }
    }
  }

  private requireCleanerRepository(): MatchJobCleanerRepository {
    if (!this.cleanerRepository) {
      throw new SafeMatchJobError("cleaner_repository_unavailable")
    }

    return this.cleanerRepository
  }

  private async processClaimedJob(job: MatchJobRecord): Promise<void> {
    try {
      if (!job.uploadStorageKey || !job.uploadContentType) {
        throw new SafeMatchJobError("upload_not_found")
      }

      const bytes = await this.storage.read(job.uploadStorageKey)
      const signals = await this.extractor.extract({
        bytes,
        contentType: job.uploadContentType,
      })
      const candidates = await this.matcher.match(signals, {
        limit: job.resultLimit,
      })

      await this.repository.replaceCandidates(job.id, candidates)
      await cleanupStoredUpload(this.storage, job.uploadStorageKey)
      await this.repository.update(job.id, {
        status: "complete",
        inputDurationMilliseconds: signals.durationMilliseconds,
        completedAt: this.now(),
      })
    } catch (error) {
      await cleanupStoredUpload(this.storage, job.uploadStorageKey)
      await this.repository.update(job.id, {
        status: "failed",
        failedAt: this.now(),
        safeErrorCode:
          error instanceof SafeMatchJobError ? error.code : "processing_failed",
      })
    }
  }

  async getJobResult(jobId: string): Promise<MatchJobResult | null> {
    const job = await this.repository.get(jobId)
    if (!job) return null

    if (job.status === "complete") {
      const candidates = await this.repository.listCandidates(job.id)
      return {
        candidates: candidates.map(
          ({ rank: _rank, ...candidate }) => candidate,
        ),
      }
    }

    if (job.status === "failed") {
      return {
        jobId: job.id,
        status: job.status,
        errorCode: job.safeErrorCode ?? "processing_failed",
      }
    }

    if (job.status === "expired") {
      return {
        jobId: job.id,
        status: job.status,
        errorCode: job.safeErrorCode ?? JOB_EXPIRED_ERROR_CODE,
      }
    }

    return {
      jobId: job.id,
      status: job.status,
    }
  }
}

export class InMemoryMatchJobRepository implements MatchJobRepository {
  private readonly jobs = new Map<string, MatchJobRecord>()
  private readonly candidates = new Map<string, StoredMatchCandidate[]>()
  private cleanerLeaseLockedUntil: Date | undefined
  private cleanerLeaseOwnerToken: string | undefined

  async create(job: MatchJobRecord): Promise<MatchJobRecord> {
    this.jobs.set(job.id, { ...job })
    return { ...job }
  }

  async get(jobId: string): Promise<MatchJobRecord | null> {
    const job = this.jobs.get(jobId)
    return job ? { ...job } : null
  }

  async claimQueued(
    jobId: string,
    startedAt: Date,
    staleStartedBefore: Date,
  ): Promise<MatchJobRecord | null> {
    const job = this.jobs.get(jobId)
    if (!job) return null
    const staleRunning =
      job.status === "running" &&
      job.startedAt !== undefined &&
      job.startedAt <= staleStartedBefore

    if (job.status !== "queued" && !staleRunning) return null

    const updated = {
      ...job,
      status: "running" as const,
      startedAt,
      safeErrorCode: undefined,
    }
    this.jobs.set(jobId, updated)
    return { ...updated }
  }

  async claimNextQueued(
    startedAt: Date,
    staleStartedBefore: Date,
    queuedExpiresAt?: Date,
  ): Promise<MatchJobRecord | null> {
    const job = Array.from(this.jobs.values())
      .filter((candidate) =>
        isProcessable(candidate, staleStartedBefore, queuedExpiresAt),
      )
      .sort(compareQueuedJobs)[0]

    if (!job) return null

    return this.claimQueued(job.id, startedAt, staleStartedBefore)
  }

  async expireQueuedBefore(
    queuedAtOrBefore: Date,
    limit: number,
  ): Promise<ExpireQueuedJobsBatch> {
    const candidates = Array.from(this.jobs.values())
      .filter(
        (job) => job.status === "queued" && job.queuedAt <= queuedAtOrBefore,
      )
      .sort(compareQueuedJobs)
      .slice(0, limit)

    const expiredJobs: MatchJobRecord[] = []

    for (const candidate of candidates) {
      const job = this.jobs.get(candidate.id)
      if (!job || job.status !== "queued" || job.queuedAt > queuedAtOrBefore) {
        continue
      }

      const expired = {
        ...job,
        status: "expired" as const,
        safeErrorCode: JOB_EXPIRED_ERROR_CODE,
      }
      this.jobs.set(job.id, expired)
      expiredJobs.push({ ...expired })
    }

    return {
      jobs: expiredJobs,
      scannedCount: candidates.length,
    }
  }

  async listExpiredWithUploads(
    limit: number,
    after?: ExpiredUploadCursor,
  ): Promise<MatchJobRecord[]> {
    return Array.from(this.jobs.values())
      .filter(
        (job) =>
          job.status === "expired" &&
          hasUploadFields(job) &&
          isAfterExpiredUploadCursor(job, after),
      )
      .sort(compareQueuedJobs)
      .slice(0, limit)
      .map((job) => ({ ...job }))
  }

  async clearUploadFields(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== "expired") return

    const updated = {
      ...job,
      uploadStorageKey: undefined,
      uploadContentType: undefined,
      uploadByteLength: undefined,
    }
    this.jobs.set(jobId, updated)
  }

  async countExpiredWithUploads(): Promise<number> {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === "expired" && hasUploadFields(job),
    ).length
  }

  async tryAcquireCleanerLease(
    now: Date,
    lockedUntil: Date,
    ownerToken: string,
  ): Promise<boolean> {
    if (this.cleanerLeaseLockedUntil && this.cleanerLeaseLockedUntil > now) {
      return false
    }

    this.cleanerLeaseLockedUntil = lockedUntil
    this.cleanerLeaseOwnerToken = ownerToken
    return true
  }

  async releaseCleanerLease(now: Date, ownerToken: string): Promise<void> {
    if (
      this.cleanerLeaseOwnerToken === ownerToken &&
      this.cleanerLeaseLockedUntil &&
      this.cleanerLeaseLockedUntil > now
    ) {
      this.cleanerLeaseLockedUntil = now
    }
  }

  async update(
    jobId: string,
    patch: Partial<Omit<MatchJobRecord, "id">>,
  ): Promise<MatchJobRecord> {
    const job = this.jobs.get(jobId)
    if (!job) throw new SafeMatchJobError("job_not_found")

    const updated = { ...job, ...patch }
    this.jobs.set(jobId, updated)
    return { ...updated }
  }

  async replaceCandidates(
    jobId: string,
    candidates: PublicMatchCandidate[],
  ): Promise<StoredMatchCandidate[]> {
    const ranked = candidates.map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }))

    this.candidates.set(jobId, ranked)
    return ranked.map((candidate) => ({ ...candidate }))
  }

  async listCandidates(jobId: string): Promise<StoredMatchCandidate[]> {
    return (this.candidates.get(jobId) ?? []).map((candidate) => ({
      ...candidate,
    }))
  }
}

function isTerminalJob(job: MatchJobRecord): boolean {
  return (
    job.status === "complete" ||
    job.status === "failed" ||
    job.status === "expired"
  )
}

function isProcessable(
  job: MatchJobRecord,
  staleStartedBefore: Date,
  queuedExpiresAt: Date | undefined,
): boolean {
  if (job.status === "queued") {
    return queuedExpiresAt ? job.queuedAt > queuedExpiresAt : true
  }

  return (
    job.status === "running" &&
    job.startedAt !== undefined &&
    job.startedAt <= staleStartedBefore
  )
}

function hasUploadFields(job: MatchJobRecord): boolean {
  return (
    job.uploadStorageKey !== undefined ||
    job.uploadContentType !== undefined ||
    job.uploadByteLength !== undefined
  )
}

function compareQueuedJobs(a: MatchJobRecord, b: MatchJobRecord): number {
  const queuedDelta = a.queuedAt.getTime() - b.queuedAt.getTime()
  if (queuedDelta !== 0) return queuedDelta
  return a.id.localeCompare(b.id)
}

function toExpiredUploadCursor(job: MatchJobRecord): ExpiredUploadCursor {
  return {
    queuedAt: job.queuedAt,
    id: job.id,
  }
}

function isAfterExpiredUploadCursor(
  job: MatchJobRecord,
  cursor: ExpiredUploadCursor | undefined,
): boolean {
  if (!cursor) return true
  if (job.queuedAt > cursor.queuedAt) return true
  return (
    job.queuedAt.getTime() === cursor.queuedAt.getTime() && job.id > cursor.id
  )
}

function asMatchJobCleanerRepository(
  repository: MatchJobRepository,
): MatchJobCleanerRepository | undefined {
  const candidate = repository as MatchJobRepository &
    Partial<MatchJobCleanerRepository>

  if (
    typeof candidate.expireQueuedBefore === "function" &&
    typeof candidate.listExpiredWithUploads === "function" &&
    typeof candidate.clearUploadFields === "function" &&
    typeof candidate.countExpiredWithUploads === "function" &&
    typeof candidate.tryAcquireCleanerLease === "function" &&
    typeof candidate.releaseCleanerLease === "function"
  ) {
    return candidate as MatchJobCleanerRepository
  }

  return undefined
}

function emptyCleanerSummary({
  skippedDueToLock = false,
}: {
  skippedDueToLock?: boolean
} = {}): MatchJobCleanerSummary {
  return {
    expiredJobs: 0,
    uploadCleanupSucceeded: 0,
    uploadCleanupFailed: 0,
    expiredUploadRetries: 0,
    remainingExpiredUploads: 0,
    skippedDueToLock,
  }
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1_000)
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1_000)
}

async function cleanupStoredUpload(
  storage: UploadStorage,
  key: string | undefined,
): Promise<void> {
  if (!key) return

  try {
    await storage.remove(key)
  } catch {
    // Cleanup is best-effort; the job failure reason should remain the
    // processing error that caused the terminal state.
  }
}
