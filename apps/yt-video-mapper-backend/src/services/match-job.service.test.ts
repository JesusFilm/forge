import { describe, expect, it } from "vitest"
import type { PublicMatchCandidate } from "../domain/match.js"
import {
  InMemoryMatchJobRepository,
  MatchJobService,
  SafeMatchJobError,
  type Matcher,
} from "./match-job.service.js"
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
  storage = new InMemoryUploadStorage(),
  extractor = new StubExtractor({
    visualHashes: [],
    audioFingerprints: [],
  }),
  matcher = new StubMatcher([]),
}: {
  storage?: InMemoryUploadStorage
  extractor?: UploadSignalExtractor
  matcher?: Matcher
} = {}) {
  return new MatchJobService(
    new InMemoryMatchJobRepository(),
    storage,
    extractor,
    matcher,
    () => new Date("2026-06-08T00:00:00.000Z"),
  )
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

class FailingCreateRepository extends InMemoryMatchJobRepository {
  storedKey: string | undefined

  override async create(
    job: Parameters<InMemoryMatchJobRepository["create"]>[0],
  ): Promise<never> {
    this.storedKey = job.uploadStorageKey
    throw new RepositoryCreateTestError()
  }
}
