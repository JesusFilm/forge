import { describe, expect, it } from "vitest"
import type { PublicMatchCandidate } from "../domain/match.js"
import {
  InMemoryMatchJobRepository,
  JOB_EXPIRED_ERROR_CODE,
  MatchJobService,
  SafeMatchJobError,
  type Matcher,
} from "./match-job.service.js"
import {
  InMemoryMediaSignatureMatchRepository,
  MediaSignatureMatcher,
  type MatchableMediaSignature,
} from "./media-signature-matcher.js"
import { DeterministicUploadSignalExtractor } from "./upload-signal-extraction.js"
import type {
  UploadSignalExtractor,
  UploadSignals,
} from "./upload-signal-extraction.js"
import { InMemoryUploadStorage } from "./upload-storage.js"

const candidate: PublicMatchCandidate = {
  coreId: "core-jesus-film",
  videoVariantId: "variant-en",
  confidence: 0.91,
  matchStrength: "high",
}

describe("MatchJobService", () => {
  it("creates a queued job, processes it, and removes raw upload bytes", async () => {
    const storage = new InMemoryUploadStorage()
    const service = createService({
      storage,
      extractor: new StubExtractor({
        visualHashes: ["frame-a"],
        audioFingerprints: ["audio-a"],
      }),
      matcher: new StubMatcher([candidate]),
    })

    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    expect(job.status).toBe("queued")
    expect(job.uploadStorageKey).toBeDefined()
    expect(storage.has(job.uploadStorageKey!)).toBe(true)

    await service.processJob(job.id)

    expect(storage.has(job.uploadStorageKey!)).toBe(false)
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      candidates: [candidate],
    })
  })

  it("processes a job through real upload extraction and media signature matching", async () => {
    const service = new MatchJobService(
      new InMemoryMatchJobRepository(),
      new InMemoryUploadStorage(),
      new DeterministicUploadSignalExtractor(4),
      new MediaSignatureMatcher(
        new InMemoryMediaSignatureMatchRepository([
          structuralSignature({
            coreId: "core-jesus-film",
            videoVariantId: "variant-en",
            sha256:
              "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
          }),
        ]),
      ),
      () => new Date("2026-06-08T00:00:00.000Z"),
    )
    const job = await service.createUploadJob({
      bytes: Buffer.from([1, 2, 3, 4]),
      contentType: "video/mp4",
    })

    await service.processJob(job.id)

    await expect(service.getJobResult(job.id)).resolves.toEqual({
      candidates: [
        {
          coreId: "core-jesus-film",
          videoVariantId: "variant-en",
          confidence: 1,
          matchStrength: "high",
        },
      ],
    })
  })

  it("stores a safe failed status when extraction fails", async () => {
    const service = createService({
      extractor: {
        async extract() {
          throw new SafeMatchJobError("extraction_failed")
        },
      },
      matcher: new StubMatcher([candidate]),
    })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    await service.processJob(job.id)

    await expect(service.getJobResult(job.id)).resolves.toEqual({
      jobId: job.id,
      status: "failed",
      errorCode: "extraction_failed",
    })
  })

  it("stores a generic safe failed status and removes upload bytes on unexpected failures", async () => {
    const storage = new InMemoryUploadStorage()
    const service = createService({
      storage,
      extractor: new StubExtractor({
        visualHashes: [],
        audioFingerprints: [],
      }),
      matcher: {
        async match() {
          throw new UploadProcessingTestError()
        },
      },
    })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    await service.processJob(job.id)

    expect(storage.has(job.uploadStorageKey!)).toBe(false)
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      jobId: job.id,
      status: "failed",
      errorCode: "processing_failed",
    })
  })

  it("processes the oldest queued job when draining the queue", async () => {
    const storage = new InMemoryUploadStorage()
    const repository = new InMemoryMatchJobRepository()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = createService({
      repository,
      storage,
      matcher: new StubMatcher([candidate]),
      now: () => now,
    })

    const first = await service.createUploadJob({
      bytes: Buffer.from("first-video"),
      contentType: "video/mp4",
    })
    now = new Date("2026-06-08T00:01:00.000Z")
    const second = await service.createUploadJob({
      bytes: Buffer.from("second-video"),
      contentType: "video/mp4",
    })
    now = new Date("2026-06-08T00:02:00.000Z")

    await expect(service.processNextJob()).resolves.toMatchObject({
      id: first.id,
    })

    await expect(service.getJobResult(first.id)).resolves.toEqual({
      candidates: [candidate],
    })
    await expect(service.getJobResult(second.id)).resolves.toEqual({
      jobId: second.id,
      status: "queued",
    })
  })

  it("reclaims stale running jobs when draining the queue", async () => {
    const storage = new InMemoryUploadStorage()
    const storedUpload = await storage.put({
      bytes: Buffer.from("stale-video"),
      contentType: "video/mp4",
    })
    const repository = new InMemoryMatchJobRepository()
    await repository.create({
      id: "job-stale",
      status: "running",
      uploadStorageKey: storedUpload.key,
      uploadContentType: storedUpload.contentType,
      uploadByteLength: storedUpload.byteLength,
      resultLimit: 3,
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
      startedAt: new Date("2026-06-08T00:00:00.000Z"),
    })
    const service = createService({
      repository,
      storage,
      matcher: new StubMatcher([candidate]),
      now: () => new Date("2026-06-08T00:45:00.000Z"),
    })

    await expect(service.processNextJob()).resolves.toMatchObject({
      id: "job-stale",
    })

    await expect(service.getJobResult("job-stale")).resolves.toEqual({
      candidates: [candidate],
    })
  })

  it("does not claim fresh running jobs when draining the queue", async () => {
    const storage = new InMemoryUploadStorage()
    const storedUpload = await storage.put({
      bytes: Buffer.from("fresh-video"),
      contentType: "video/mp4",
    })
    const repository = new InMemoryMatchJobRepository()
    await repository.create({
      id: "job-fresh",
      status: "running",
      uploadStorageKey: storedUpload.key,
      uploadContentType: storedUpload.contentType,
      uploadByteLength: storedUpload.byteLength,
      resultLimit: 3,
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
      startedAt: new Date("2026-06-08T00:20:00.000Z"),
    })
    const service = createService({
      repository,
      storage,
      matcher: new StubMatcher([candidate]),
      now: () => new Date("2026-06-08T00:45:00.000Z"),
    })

    await expect(service.processNextJob()).resolves.toBeNull()
    await expect(service.getJobResult("job-fresh")).resolves.toEqual({
      jobId: "job-fresh",
      status: "running",
    })
  })

  it("keeps running jobs from being claimed by duplicate processors", async () => {
    const repository = new InMemoryMatchJobRepository()
    const job = await repository.create({
      id: "job-1",
      status: "running",
      resultLimit: 3,
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
    })

    await expect(
      repository.claimQueued(
        job.id,
        new Date("2026-06-08T00:01:00.000Z"),
        new Date("2026-06-07T23:30:00.000Z"),
      ),
    ).resolves.toBeNull()
  })

  it("can reclaim stale running jobs for retry", async () => {
    const repository = new InMemoryMatchJobRepository()
    const job = await repository.create({
      id: "job-1",
      status: "running",
      resultLimit: 3,
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
      startedAt: new Date("2026-06-08T00:00:00.000Z"),
    })

    await expect(
      repository.claimQueued(
        job.id,
        new Date("2026-06-08T00:45:00.000Z"),
        new Date("2026-06-08T00:15:00.000Z"),
      ),
    ).resolves.toMatchObject({
      id: job.id,
      status: "running",
      startedAt: new Date("2026-06-08T00:45:00.000Z"),
    })
  })

  it("does not reprocess a job that has already reached a terminal state", async () => {
    const matcher = new CountingMatcher([candidate])
    const service = createService({ matcher })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    await service.processJob(job.id)
    await service.processJob(job.id)

    expect(matcher.calls).toBe(1)
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      candidates: [candidate],
    })
  })

  it("returns expired jobs as terminal results and does not reprocess them", async () => {
    const repository = new InMemoryMatchJobRepository()
    const matcher = new CountingMatcher([candidate])
    const service = createService({ repository, matcher })
    await repository.create({
      id: "job-expired",
      status: "expired",
      resultLimit: 3,
      safeErrorCode: JOB_EXPIRED_ERROR_CODE,
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
    })

    await service.processJob("job-expired")

    expect(matcher.calls).toBe(0)
    await expect(service.getJobResult("job-expired")).resolves.toEqual({
      jobId: "job-expired",
      status: "expired",
      errorCode: "job_expired",
    })
  })

  it("expires abandoned queued jobs, removes uploads, and keeps rows pollable", async () => {
    const storage = new InMemoryUploadStorage()
    const repository = new InMemoryMatchJobRepository()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = createService({
      repository,
      storage,
      now: () => now,
    })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    now = new Date("2026-06-08T00:31:00.000Z")

    await expect(service.cleanExpiredQueuedJobs()).resolves.toEqual({
      expiredJobs: 1,
      uploadCleanupSucceeded: 1,
      uploadCleanupFailed: 0,
      expiredUploadRetries: 0,
      remainingExpiredUploads: 0,
      skippedDueToLock: false,
    })

    expect(storage.has(job.uploadStorageKey!)).toBe(false)
    await expect(repository.get(job.id)).resolves.toMatchObject({
      id: job.id,
      status: "expired",
      safeErrorCode: "job_expired",
      uploadStorageKey: undefined,
      uploadContentType: undefined,
      uploadByteLength: undefined,
    })
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      jobId: job.id,
      status: "expired",
      errorCode: "job_expired",
    })
  })

  it("expires queued jobs at the 30 minute boundary but not before it", async () => {
    const storage = new InMemoryUploadStorage()
    const repository = new InMemoryMatchJobRepository()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = createService({
      repository,
      storage,
      now: () => now,
    })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    now = new Date("2026-06-08T00:29:59.000Z")

    await expect(service.cleanExpiredQueuedJobs()).resolves.toMatchObject({
      expiredJobs: 0,
      remainingExpiredUploads: 0,
    })
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      jobId: job.id,
      status: "queued",
    })

    now = new Date("2026-06-08T00:30:00.000Z")

    await expect(service.cleanExpiredQueuedJobs()).resolves.toMatchObject({
      expiredJobs: 1,
      remainingExpiredUploads: 0,
    })
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      jobId: job.id,
      status: "expired",
      errorCode: "job_expired",
    })
  })

  it("does not expire running jobs and still lets stale running jobs be reclaimed", async () => {
    const storage = new InMemoryUploadStorage()
    const storedUpload = await storage.put({
      bytes: Buffer.from("stale-video"),
      contentType: "video/mp4",
    })
    const repository = new InMemoryMatchJobRepository()
    await repository.create({
      id: "job-stale-running",
      status: "running",
      uploadStorageKey: storedUpload.key,
      uploadContentType: storedUpload.contentType,
      uploadByteLength: storedUpload.byteLength,
      resultLimit: 3,
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
      startedAt: new Date("2026-06-08T00:00:00.000Z"),
    })
    const service = createService({
      repository,
      storage,
      matcher: new StubMatcher([candidate]),
      now: () => new Date("2026-06-08T00:45:00.000Z"),
    })

    await expect(service.cleanExpiredQueuedJobs()).resolves.toMatchObject({
      expiredJobs: 0,
      remainingExpiredUploads: 0,
    })
    await expect(service.processNextJob()).resolves.toMatchObject({
      id: "job-stale-running",
      status: "running",
    })
    await expect(service.getJobResult("job-stale-running")).resolves.toEqual({
      candidates: [candidate],
    })
  })

  it("lets manual processing rescue an overdue queued job before cleanup wins", async () => {
    const repository = new InMemoryMatchJobRepository()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = createService({
      repository,
      matcher: new StubMatcher([candidate]),
      now: () => now,
    })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    now = new Date("2026-06-08T00:31:00.000Z")
    await service.processJob(job.id)

    await expect(service.getJobResult(job.id)).resolves.toEqual({
      candidates: [candidate],
    })
  })

  it("does not auto-claim expiry-eligible queued jobs while draining", async () => {
    const repository = new InMemoryMatchJobRepository()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = createService({
      repository,
      matcher: new StubMatcher([candidate]),
      now: () => now,
    })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    now = new Date("2026-06-08T00:31:00.000Z")

    await expect(service.processNextJob()).resolves.toBeNull()
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      jobId: job.id,
      status: "queued",
    })

    await service.cleanExpiredQueuedJobs()
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      jobId: job.id,
      status: "expired",
      errorCode: "job_expired",
    })
  })

  it("drains all overdue queued jobs in bounded pages during one cleanup pass", async () => {
    const repository = new InMemoryMatchJobRepository()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = createService({
      repository,
      now: () => now,
    })

    const jobs = await Promise.all(
      ["first", "second", "third"].map((name) =>
        service.createUploadJob({
          bytes: Buffer.from(`${name}-video`),
          contentType: "video/mp4",
        }),
      ),
    )

    now = new Date("2026-06-08T00:31:00.000Z")

    await expect(
      service.cleanExpiredQueuedJobs({ pageSize: 2 }),
    ).resolves.toMatchObject({
      expiredJobs: 3,
      uploadCleanupSucceeded: 3,
      remainingExpiredUploads: 0,
    })

    for (const job of jobs) {
      await expect(service.getJobResult(job.id)).resolves.toMatchObject({
        status: "expired",
        errorCode: "job_expired",
      })
    }
  })

  it("retries upload cleanup for expired rows with leftover upload fields", async () => {
    const storage = new FailingRemoveOnceUploadStorage()
    const repository = new InMemoryMatchJobRepository()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = createService({
      repository,
      storage,
      now: () => now,
    })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })

    now = new Date("2026-06-08T00:31:00.000Z")

    await expect(service.cleanExpiredQueuedJobs()).resolves.toMatchObject({
      expiredJobs: 1,
      uploadCleanupSucceeded: 0,
      uploadCleanupFailed: 1,
      remainingExpiredUploads: 1,
    })
    expect(storage.has(job.uploadStorageKey!)).toBe(true)

    await expect(service.cleanExpiredQueuedJobs()).resolves.toMatchObject({
      expiredJobs: 0,
      uploadCleanupSucceeded: 1,
      uploadCleanupFailed: 0,
      expiredUploadRetries: 1,
      remainingExpiredUploads: 0,
    })
    expect(storage.has(job.uploadStorageKey!)).toBe(false)
    await expect(repository.get(job.id)).resolves.toMatchObject({
      status: "expired",
      uploadStorageKey: undefined,
      uploadContentType: undefined,
      uploadByteLength: undefined,
    })
  })

  it("skips cleanup when another cleaner owns the lease", async () => {
    const storage = new InMemoryUploadStorage()
    const repository = new InMemoryMatchJobRepository()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = createService({
      repository,
      storage,
      now: () => now,
    })
    const job = await service.createUploadJob({
      bytes: Buffer.from("video-bytes"),
      contentType: "video/mp4",
    })
    await repository.tryAcquireCleanerLease(
      now,
      new Date("2026-06-08T00:40:00.000Z"),
      "other-cleaner",
    )
    now = new Date("2026-06-08T00:31:00.000Z")

    await expect(service.cleanExpiredQueuedJobs()).resolves.toEqual({
      expiredJobs: 0,
      uploadCleanupSucceeded: 0,
      uploadCleanupFailed: 0,
      expiredUploadRetries: 0,
      remainingExpiredUploads: 0,
      skippedDueToLock: true,
    })

    expect(storage.has(job.uploadStorageKey!)).toBe(true)
    await expect(service.getJobResult(job.id)).resolves.toEqual({
      jobId: job.id,
      status: "queued",
    })
  })

  it("does not let an expired cleaner release a newer cleaner lease", async () => {
    const repository = new InMemoryMatchJobRepository()

    await expect(
      repository.tryAcquireCleanerLease(
        new Date("2026-06-08T00:00:00.000Z"),
        new Date("2026-06-08T00:30:00.000Z"),
        "cleaner-a",
      ),
    ).resolves.toBe(true)
    await expect(
      repository.tryAcquireCleanerLease(
        new Date("2026-06-08T00:31:00.000Z"),
        new Date("2026-06-08T01:01:00.000Z"),
        "cleaner-b",
      ),
    ).resolves.toBe(true)

    await repository.releaseCleanerLease(
      new Date("2026-06-08T00:32:00.000Z"),
      "cleaner-a",
    )

    await expect(
      repository.tryAcquireCleanerLease(
        new Date("2026-06-08T00:33:00.000Z"),
        new Date("2026-06-08T01:03:00.000Z"),
        "cleaner-c",
      ),
    ).resolves.toBe(false)

    await repository.releaseCleanerLease(
      new Date("2026-06-08T00:34:00.000Z"),
      "cleaner-b",
    )
    await expect(
      repository.tryAcquireCleanerLease(
        new Date("2026-06-08T00:35:00.000Z"),
        new Date("2026-06-08T01:05:00.000Z"),
        "cleaner-c",
      ),
    ).resolves.toBe(true)
  })

  it("only clears upload fields for expired rows", async () => {
    const repository = new InMemoryMatchJobRepository()
    await repository.create({
      id: "job-queued",
      status: "queued",
      uploadStorageKey: "queued-key",
      uploadContentType: "video/mp4",
      uploadByteLength: 10,
      resultLimit: 3,
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
    })
    await repository.create({
      id: "job-expired",
      status: "expired",
      uploadStorageKey: "expired-key",
      uploadContentType: "video/mp4",
      uploadByteLength: 10,
      resultLimit: 3,
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
    })

    await repository.clearUploadFields("job-queued")
    await repository.clearUploadFields("job-expired")

    await expect(repository.get("job-queued")).resolves.toMatchObject({
      uploadStorageKey: "queued-key",
      uploadContentType: "video/mp4",
      uploadByteLength: 10,
    })
    await expect(repository.get("job-expired")).resolves.toMatchObject({
      uploadStorageKey: undefined,
      uploadContentType: undefined,
      uploadByteLength: undefined,
    })
  })

  it("caps expired upload cleanup retries to one page per cleaner tick", async () => {
    const storage = new AlwaysFailingRemoveUploadStorage()
    const repository = new InMemoryMatchJobRepository()
    const service = createService({
      repository,
      storage,
      now: () => new Date("2026-06-08T00:31:00.000Z"),
    })

    for (const id of ["job-1", "job-2", "job-3"]) {
      const storedUpload = await storage.put({
        bytes: Buffer.from(id),
        contentType: "video/mp4",
      })
      await repository.create({
        id,
        status: "expired",
        uploadStorageKey: storedUpload.key,
        uploadContentType: storedUpload.contentType,
        uploadByteLength: storedUpload.byteLength,
        resultLimit: 3,
        safeErrorCode: JOB_EXPIRED_ERROR_CODE,
        queuedAt: new Date("2026-06-08T00:00:00.000Z"),
      })
    }

    await expect(
      service.cleanExpiredQueuedJobs({ pageSize: 2 }),
    ).resolves.toMatchObject({
      expiredJobs: 0,
      expiredUploadRetries: 2,
      uploadCleanupFailed: 2,
      remainingExpiredUploads: 3,
    })
  })

  it("rejects empty uploads before storing a job", async () => {
    const service = createService()

    await expect(
      service.createUploadJob({
        bytes: Buffer.alloc(0),
        contentType: "video/mp4",
      }),
    ).rejects.toMatchObject({ code: "empty_upload" })
  })

  it("removes stored upload bytes when job creation fails", async () => {
    const storage = new InMemoryUploadStorage()
    const repository = new FailingCreateRepository()
    const service = new MatchJobService(
      repository,
      storage,
      new StubExtractor({
        visualHashes: [],
        audioFingerprints: [],
      }),
      new StubMatcher([]),
      () => new Date("2026-06-08T00:00:00.000Z"),
    )

    await expect(
      service.createUploadJob({
        bytes: Buffer.from("video-bytes"),
        contentType: "video/mp4",
      }),
    ).rejects.toBeInstanceOf(RepositoryCreateTestError)

    expect(repository.storedKey).toBeDefined()
    expect(storage.has(repository.storedKey!)).toBe(false)
  })
})

function createService({
  repository = new InMemoryMatchJobRepository(),
  storage = new InMemoryUploadStorage(),
  extractor = new StubExtractor({
    visualHashes: [],
    audioFingerprints: [],
  }),
  matcher = new StubMatcher([]),
  now = () => new Date("2026-06-08T00:00:00.000Z"),
}: {
  repository?: InMemoryMatchJobRepository
  storage?: InMemoryUploadStorage
  extractor?: UploadSignalExtractor
  matcher?: Matcher
  now?: () => Date
} = {}) {
  return new MatchJobService(repository, storage, extractor, matcher, now)
}

class StubExtractor implements UploadSignalExtractor {
  constructor(private readonly signals: UploadSignals) {}

  async extract(): Promise<UploadSignals> {
    return this.signals
  }
}

class StubMatcher implements Matcher {
  constructor(private readonly candidates: PublicMatchCandidate[]) {}

  async match(): Promise<PublicMatchCandidate[]> {
    return this.candidates
  }
}

class CountingMatcher implements Matcher {
  calls = 0

  constructor(private readonly candidates: PublicMatchCandidate[]) {}

  async match(): Promise<PublicMatchCandidate[]> {
    this.calls += 1
    return this.candidates
  }
}

class FailingRemoveOnceUploadStorage extends InMemoryUploadStorage {
  private readonly failedKeys = new Set<string>()

  override async remove(key: string): Promise<void> {
    if (!this.failedKeys.has(key)) {
      this.failedKeys.add(key)
      throw new UploadCleanupTestError()
    }

    await super.remove(key)
  }
}

class AlwaysFailingRemoveUploadStorage extends InMemoryUploadStorage {
  override async remove(): Promise<void> {
    throw new UploadCleanupTestError()
  }
}

class UploadProcessingTestError extends Error {
  constructor() {
    super("unexpected processing failure")
  }
}

class RepositoryCreateTestError extends Error {
  constructor() {
    super("repository create failed")
  }
}

class UploadCleanupTestError extends Error {
  constructor() {
    super("upload cleanup failed")
  }
}

class FailingCreateRepository extends InMemoryMatchJobRepository {
  storedKey: string | undefined

  override async create(
    job: Parameters<InMemoryMatchJobRepository["create"]>[0],
  ): Promise<never> {
    this.storedKey = job.uploadStorageKey
    throw new RepositoryCreateTestError()
  }
}

function structuralSignature({
  coreId,
  videoVariantId,
  sha256,
}: {
  coreId: string
  videoVariantId: string
  sha256: string
}): MatchableMediaSignature {
  return {
    coreId,
    videoVariantId,
    signatureType: "STRUCTURAL_HINT",
    offsetMilliseconds: 0,
    durationMilliseconds: 120_000,
    signature: {
      kind: "structural_hint_v1",
      byteSample: {
        sha256,
        byteLength: 4,
        rangeStart: 0,
        rangeEnd: 3,
        complete: true,
      },
    },
    catalogVariant: {
      durationSeconds: 120,
      lengthInMilliseconds: null,
      languageSlug: "english",
      locale: "en",
    },
  }
}
