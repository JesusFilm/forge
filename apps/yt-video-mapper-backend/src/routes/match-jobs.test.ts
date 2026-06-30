import { Readable, Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import type { PublicMatchCandidate } from "../domain/match.js"
import { createHandleRequest } from "../server.js"
import {
  InMemoryMatchJobRepository,
  MatchJobService,
  type Matcher,
} from "../services/match-job.service.js"
import {
  InMemoryMediaSignatureMatchRepository,
  MediaSignatureMatcher,
  type MatchableMediaSignature,
} from "../services/media-signature-matcher.js"
import { DeterministicUploadSignalExtractor } from "../services/upload-signal-extraction.js"
import type {
  UploadSignalExtractor,
  UploadSignals,
} from "../services/upload-signal-extraction.js"
import { InMemoryUploadStorage } from "../services/upload-storage.js"

const candidate: PublicMatchCandidate = {
  coreId: "core-jesus-film",
  videoVariantId: "variant-en",
  confidence: 0.91,
  matchStrength: "high",
}

class TestResponse extends Writable {
  statusCode = 200
  headers: Record<string, string> = {}
  body = ""

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: () => void,
  ): void {
    this.body += chunk.toString()
    callback()
  }

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode
    this.headers = headers
    return this
  }
}

describe("match jobs route", () => {
  it("creates a queued upload job", async () => {
    const { request } = createHarness({ apiToken: "test-token" })

    const response = await request(
      "POST",
      "/match-jobs",
      Buffer.from("video"),
      {
        authorization: "Bearer test-token",
      },
    )

    expect(response.statusCode).toBe(202)
    expect(response.body).toMatchObject({ status: "queued" })
    expect(typeof response.body.jobId).toBe("string")
  })

  it("polls queued jobs without exposing candidates", async () => {
    const { request } = createHarness()
    const created = await request("POST", "/match-jobs", Buffer.from("video"))
    const jobId = String(created.body.jobId)

    const response = await request("GET", `/match-jobs/${jobId}`)

    expect(response).toEqual({
      statusCode: 200,
      body: {
        jobId,
        status: "queued",
      },
    })
  })

  it("polls expired jobs with the explicit expiry error code", async () => {
    const repository = new InMemoryMatchJobRepository()
    const storage = new InMemoryUploadStorage()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = new MatchJobService(
      repository,
      storage,
      new StubExtractor({
        visualHashes: ["frame-a"],
        audioFingerprints: ["audio-a"],
      }),
      new StubMatcher([candidate]),
      () => now,
    )
    const job = await service.createUploadJob({
      bytes: Buffer.from("video"),
      contentType: "video/mp4",
    })
    now = new Date("2026-06-08T00:31:00.000Z")
    await service.cleanExpiredQueuedJobs()
    const { request } = createHarness({ service })

    await expect(request("GET", `/match-jobs/${job.id}`)).resolves.toEqual({
      statusCode: 200,
      body: {
        jobId: job.id,
        status: "expired",
        errorCode: "job_expired",
      },
    })
  })

  it("polls complete jobs with ranked public candidates", async () => {
    const { request, service } = createHarness()
    const created = await request("POST", "/match-jobs", Buffer.from("video"))
    const jobId = String(created.body.jobId)

    await service.processJob(jobId)
    const response = await request("GET", `/match-jobs/${jobId}`)

    expect(response).toEqual({
      statusCode: 200,
      body: {
        candidates: [candidate],
      },
    })
    expect(JSON.stringify(response.body)).not.toContain("evidence")
  })

  it("lets an authenticated worker process a queued job", async () => {
    const { request } = createHarness({ apiToken: "test-token" })
    const created = await request("POST", "/match-jobs", Buffer.from("video"), {
      authorization: "Bearer test-token",
    })
    const jobId = String(created.body.jobId)

    await expect(
      request("POST", `/match-jobs/${jobId}/process`, Buffer.alloc(0), {
        authorization: "Bearer test-token",
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        candidates: [candidate],
      },
    })
  })

  it("returns the expired terminal payload from the manual process endpoint", async () => {
    const repository = new InMemoryMatchJobRepository()
    const storage = new InMemoryUploadStorage()
    let now = new Date("2026-06-08T00:00:00.000Z")
    const service = new MatchJobService(
      repository,
      storage,
      new StubExtractor({
        visualHashes: ["frame-a"],
        audioFingerprints: ["audio-a"],
      }),
      new StubMatcher([candidate]),
      () => now,
    )
    const job = await service.createUploadJob({
      bytes: Buffer.from("video"),
      contentType: "video/mp4",
    })
    now = new Date("2026-06-08T00:31:00.000Z")
    await service.cleanExpiredQueuedJobs()
    const { request } = createHarness({ service })

    await expect(
      request("POST", `/match-jobs/${job.id}/process`),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        jobId: job.id,
        status: "expired",
        errorCode: "job_expired",
      },
    })
  })

  it("processes a queued job through real extraction and matching", async () => {
    const { request } = createHarness({
      service: createRealMatcherService(),
    })
    const created = await request(
      "POST",
      "/match-jobs",
      Buffer.from([1, 2, 3, 4]),
    )
    const jobId = String(created.body.jobId)

    const response = await request("POST", `/match-jobs/${jobId}/process`)

    expect(response).toEqual({
      statusCode: 200,
      body: {
        candidates: [
          {
            coreId: "core-jesus-film",
            videoVariantId: "variant-en",
            confidence: 1,
            matchStrength: "high",
          },
        ],
      },
    })
    expect(JSON.stringify(response.body)).not.toContain("evidence")
  })

  it("rejects oversized uploads safely", async () => {
    const { request } = createHarness({ maxUploadBytes: 3 })

    await expect(
      request("POST", "/match-jobs", Buffer.from("video")),
    ).resolves.toEqual({
      statusCode: 413,
      body: { error: "upload_too_large" },
    })
  })

  it("returns job_not_found for authorized polling of unknown jobs", async () => {
    const { request } = createHarness({ apiToken: "test-token" })

    await expect(
      request("GET", "/match-jobs/missing-job", Buffer.alloc(0), {
        authorization: "Bearer test-token",
      }),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "job_not_found" },
    })
  })

  it("maps empty upload rejection to a safe client error", async () => {
    const { request } = createHarness()

    await expect(request("POST", "/match-jobs")).resolves.toEqual({
      statusCode: 400,
      body: { error: "empty_upload" },
    })
  })

  it("rejects upload and polling requests without the mapper API token", async () => {
    const { request } = createHarness({ apiToken: "test-token" })

    await expect(
      request("POST", "/match-jobs", Buffer.from("video")),
    ).resolves.toEqual({
      statusCode: 401,
      body: { error: "unauthorized" },
    })

    await expect(request("GET", "/match-jobs/any-job")).resolves.toEqual({
      statusCode: 401,
      body: { error: "unauthorized" },
    })
  })
})

function createHarness({
  maxUploadBytes = 1_000,
  apiToken,
  service,
}: {
  maxUploadBytes?: number
  apiToken?: string
  service?: MatchJobService
} = {}) {
  const matchJobService =
    service ??
    new MatchJobService(
      new InMemoryMatchJobRepository(),
      new InMemoryUploadStorage(),
      new StubExtractor({
        visualHashes: ["frame-a"],
        audioFingerprints: ["audio-a"],
      }),
      new StubMatcher([candidate]),
      () => new Date("2026-06-08T00:00:00.000Z"),
    )
  const handleRequest = createHandleRequest({
    matchJobService,
    autoProcessMatchJobs: false,
    maxUploadBytes,
    apiToken,
  })

  return {
    service: matchJobService,
    async request(
      method: string,
      url: string,
      body = Buffer.alloc(0),
      headers: Record<string, string> = {},
    ) {
      const incoming = Readable.from(body.byteLength > 0 ? [body] : [])
      Object.assign(incoming, {
        method,
        url,
        headers: { "content-type": "video/mp4", ...headers },
      })

      const response = new TestResponse()
      await handleRequest(incoming as never, response as never)

      return {
        statusCode: response.statusCode,
        body: JSON.parse(response.body) as Record<string, unknown>,
      }
    },
  }
}

function createRealMatcherService(): MatchJobService {
  return new MatchJobService(
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
