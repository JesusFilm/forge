import { randomUUID } from "node:crypto"
import { env } from "../config/env.js"
import type { PublicMatchCandidate } from "../domain/match.js"
import type {
  UploadSignalExtractor,
  UploadSignals,
} from "./upload-signal-extraction.js"
import type { UploadStorage } from "./upload-storage.js"

export type MatchJobStatus = "queued" | "running" | "complete" | "failed"

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
  constructor(
    private readonly repository: MatchJobRepository,
    private readonly storage: UploadStorage,
    private readonly extractor: UploadSignalExtractor,
    private readonly matcher: Matcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    if (existingJob.status === "complete" || existingJob.status === "failed") {
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
    )
    if (!job) return null

    await this.processClaimedJob(job)
    return job
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

    return {
      jobId: job.id,
      status: job.status,
    }
  }
}

export class InMemoryMatchJobRepository implements MatchJobRepository {
  private readonly jobs = new Map<string, MatchJobRecord>()
  private readonly candidates = new Map<string, StoredMatchCandidate[]>()

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
  ): Promise<MatchJobRecord | null> {
    const job = Array.from(this.jobs.values())
      .filter((candidate) => isProcessable(candidate, staleStartedBefore))
      .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())[0]

    if (!job) return null

    return this.claimQueued(job.id, startedAt, staleStartedBefore)
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

function isProcessable(job: MatchJobRecord, staleStartedBefore: Date): boolean {
  if (job.status === "queued") return true

  return (
    job.status === "running" &&
    job.startedAt !== undefined &&
    job.startedAt <= staleStartedBefore
  )
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
