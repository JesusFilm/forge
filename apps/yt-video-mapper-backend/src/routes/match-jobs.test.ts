import { Readable, Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import type { PublicMatchCandidate } from "../domain/match.js"
import { createHandleRequest } from "../server.js"
import {
  InMemoryMatchJobRepository,
  MatchJobService,
  type Matcher,
} from "../services/match-job.service.js"
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
}: {
  maxUploadBytes?: number
  apiToken?: string
} = {}) {
  const service = new MatchJobService(
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
    matchJobService: service,
    autoProcessMatchJobs: false,
    maxUploadBytes,
    apiToken,
  })

  return {
    service,
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
