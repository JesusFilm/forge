import { describe, expect, it } from "vitest"
import type { PublicMatchCandidate } from "../domain/match.js"
import {
  InMemoryMatchJobRepository,
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
