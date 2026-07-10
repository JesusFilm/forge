import type { IncomingMessage } from "node:http"
import { Readable, Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import { createJobQueue } from "../jobs.js"
import type { runFingerprint } from "../fingerprint.js"
import type { runRender, RunRenderInput } from "../render.js"
import { createHandleRequest } from "../server.js"
import type { FingerprintSummary, RenderReport } from "../types.js"
import { jobDedupeKey, jobRequestSchema } from "./jobs.js"

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

type RequestOptions = {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
  rawBody?: string
  contentType?: string
}

function makeRequest({
  method,
  url,
  headers = {},
  body,
  rawBody,
  contentType,
}: RequestOptions): IncomingMessage {
  const payload =
    rawBody !== undefined
      ? [Buffer.from(rawBody)]
      : body !== undefined
        ? [Buffer.from(JSON.stringify(body))]
        : []
  const stream = Readable.from(payload)
  return Object.assign(stream, {
    method,
    url,
    headers: {
      ...(body !== undefined || rawBody !== undefined
        ? { "content-type": contentType ?? "application/json" }
        : {}),
      ...headers,
    },
  }) as unknown as IncomingMessage
}

type Handler = ReturnType<typeof createHandleRequest>

async function dispatch(
  handler: Handler,
  options: RequestOptions,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = new TestResponse()
  await handler(makeRequest(options), response as never)
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body) as Record<string, unknown>,
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const summary: FingerprintSummary = {
  shotCount: 2,
  durationSeconds: 10,
  width: 1920,
  height: 1080,
}

const renderReport: RenderReport = {
  version: 1,
  kind: "smart-crop-render-report",
  assetId: "asset456",
  mode: "preview",
  cropPlanArtifactType: "smart-crop-plan-9x16-v1",
  target: { aspectRatio: "9:16", width: 1080, height: 1920 },
  segmentsRendered: 1,
  segmentsPlanned: 1,
  renderedSegments: [
    {
      shotId: "shot_00001",
      sourceStartSeconds: 0,
      sourceEndSeconds: 10,
      outputStartSeconds: 0,
      outputEndSeconds: 10,
      durationSeconds: 10,
    },
  ],
  outputDurationSeconds: 10,
  outputBytes: 1000,
  renderSeconds: 1.5,
  previewFrameArtifactTypes: [],
  warnings: [],
  tool: "crop-worker-render-v1",
  generatedAt: "2026-06-09T00:00:00.000Z",
}

const fingerprintBody = {
  kind: "fingerprint",
  jobId: "manager-job-1",
  assetId: "asset123",
  source: { url: "https://stream.mux.com/pb_abc.m3u8" },
}

const authedHeaders = { authorization: "Bearer test-key" }
const auth = { apiKeysCsv: "test-key", nodeEnv: "production" }

describe("POST /jobs auth", () => {
  it("returns 401 unauthorized for a missing or wrong bearer", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
    })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        body: fingerprintBody,
      }),
    ).resolves.toEqual({ statusCode: 401, body: { error: "unauthorized" } })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: { authorization: "Bearer wrong" },
        body: fingerprintBody,
      }),
    ).resolves.toEqual({ statusCode: 401, body: { error: "unauthorized" } })
  })

  it("returns 503 config_missing in production when the allowlist is unset", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth: { apiKeysCsv: undefined, nodeEnv: "production" },
    })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        body: fingerprintBody,
      }),
    ).resolves.toEqual({ statusCode: 503, body: { error: "config_missing" } })
  })

  it("also guards GET /jobs/{id}", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
    })

    await expect(
      dispatch(handler, { method: "GET", url: "/jobs/wj_x" }),
    ).resolves.toEqual({ statusCode: 401, body: { error: "unauthorized" } })
  })
})

describe("POST /jobs validation", () => {
  it("rejects schema-invalid bodies with 400", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
    })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        body: { kind: "transcode", jobId: "x", assetId: "y" },
      }),
    ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        body: { ...fingerprintBody, source: {} },
      }),
    ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })
  })

  it("validates attempt crop plan artifact types and render artifact suffixes", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
    })
    const renderBody = {
      kind: "render",
      jobId: "manager-job-render-validation",
      assetId: "asset123",
      source: { url: "https://stream.mux.com/pb_abc.m3u8" },
      render: {
        mode: "preview",
        cropPlan: { assetId: "asset123" },
      },
    }

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        body: {
          ...renderBody,
          render: {
            ...renderBody.render,
            cropPlan: {
              assetId: "asset123",
              artifactType: "smart-crop-plan-9x16-attempt-1-v1",
            },
          },
        },
      }),
    ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        body: {
          ...renderBody,
          render: {
            ...renderBody.render,
            artifactSuffix: "attempt-1",
          },
        },
      }),
    ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })
  })

  it("rejects non-JSON content types and malformed JSON with 400", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
    })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        rawBody: "kind=fingerprint",
        contentType: "text/plain",
      }),
    ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        rawBody: "{not json",
      }),
    ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })
  })
})

describe("fingerprint job lifecycle", () => {
  it("accepts with 202 and completes with the contract result shape", async () => {
    const calls: Array<{ assetId: string; sourceUrl: string }> = []
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runFingerprintImpl: (async (input) => {
        calls.push({ assetId: input.assetId, sourceUrl: input.sourceUrl })
        return summary
      }) as typeof runFingerprint,
    })

    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })

    expect(submit.statusCode).toBe(202)
    expect(submit.body.status).toBe("queued")
    const workerJobId = submit.body.workerJobId as string
    expect(workerJobId).toMatch(/^wj_/)

    await settle()
    expect(calls).toEqual([
      {
        assetId: "asset123",
        sourceUrl: "https://stream.mux.com/pb_abc.m3u8",
      },
    ])

    const status = await dispatch(handler, {
      method: "GET",
      url: `/jobs/${workerJobId}`,
      headers: authedHeaders,
    })

    expect(status.statusCode).toBe(200)
    expect(status.body).toEqual({
      workerJobId,
      kind: "fingerprint",
      status: "completed",
      progress: 1,
      message: null,
      error: null,
      result: {
        artifacts: [
          {
            assetId: "asset123",
            artifactType: "smart-crop-fingerprint-v1",
            ext: "json",
          },
        ],
        report: summary,
      },
    })
  })
})

describe("render job lifecycle", () => {
  it("maps the request body onto runRender input", async () => {
    const inputs: RunRenderInput[] = []
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runRenderImpl: (async (input) => {
        inputs.push(input)
        return {
          artifacts: [
            {
              assetId: input.assetId,
              artifactType: "smart-crop-preview-9x16",
              ext: "mp4",
            },
          ],
          report: renderReport,
        }
      }) as typeof runRender,
    })

    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: {
        kind: "render",
        jobId: "manager-job-2",
        assetId: "asset456",
        source: { url: "https://stream.mux.com/pb_uk.m3u8" },
        render: {
          mode: "preview",
          cropPlan: {
            assetId: "asset123",
            artifactType: "smart-crop-plan-9x16-attempt-001-v1",
          },
          timelineMap: { assetId: "asset456" },
          artifactSuffix: "attempt-001",
          previewFrameCount: 6,
        },
      },
    })

    expect(submit.statusCode).toBe(202)
    await settle()

    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      assetId: "asset456",
      sourceUrl: "https://stream.mux.com/pb_uk.m3u8",
      mode: "preview",
      cropPlanAssetId: "asset123",
      cropPlanArtifactType: "smart-crop-plan-9x16-attempt-001-v1",
      timelineMapAssetId: "asset456",
      artifactSuffix: "attempt-001",
      previewFrameCount: 6,
    })
    expect(inputs[0]!.onProgress).toBeTypeOf("function")
  })

  it("defaults previewFrameCount to 0 and timelineMap to undefined", async () => {
    const inputs: RunRenderInput[] = []
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runRenderImpl: (async (input) => {
        inputs.push(input)
        return { artifacts: [], report: renderReport }
      }) as typeof runRender,
    })

    await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: {
        kind: "render",
        jobId: "manager-job-3",
        assetId: "asset123",
        source: { url: "https://stream.mux.com/pb_abc.m3u8" },
        render: { mode: "full", cropPlan: { assetId: "asset123" } },
      },
    })
    await settle()

    expect(inputs[0]).toMatchObject({
      mode: "full",
      cropPlanArtifactType: "smart-crop-plan-9x16-v1",
      previewFrameCount: 0,
    })
    expect(inputs[0]!.timelineMapAssetId).toBeUndefined()
    expect(inputs[0]!.artifactSuffix).toBeUndefined()
  })

  it("surfaces job failure through GET /jobs/{id}", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runRenderImpl: (async () => {
        throw new Error("ffmpeg is required for crop-worker.")
      }) as typeof runRender,
    })

    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: {
        kind: "render",
        jobId: "manager-job-4",
        assetId: "asset123",
        source: { url: "https://stream.mux.com/pb_abc.m3u8" },
        render: { mode: "preview", cropPlan: { assetId: "asset123" } },
      },
    })
    await settle()

    const status = await dispatch(handler, {
      method: "GET",
      url: `/jobs/${submit.body.workerJobId as string}`,
      headers: authedHeaders,
    })

    expect(status.body.status).toBe("failed")
    expect(status.body.error).toContain("ffmpeg is required")
    expect(status.body.result).toBeNull()
  })
})

describe("queue limits and unknown jobs", () => {
  it("returns 409 queue_full when the bounded queue is full", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 1 }),
      auth,
      runFingerprintImpl: (async () =>
        new Promise(() => {})) as unknown as typeof runFingerprint,
    })

    const first = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })
    expect(first.statusCode).toBe(202)

    // A DIFFERENT asset: resubmitting the same body would re-attach to the
    // active job (in-flight dedupe) instead of exercising the queue bound.
    const second = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...fingerprintBody, assetId: "asset-other" },
    })
    expect(second).toEqual({ statusCode: 409, body: { error: "queue_full" } })
  })

  it("returns 404 for unknown worker job ids", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
    })

    await expect(
      dispatch(handler, {
        method: "GET",
        url: "/jobs/wj_unknown",
        headers: authedHeaders,
      }),
    ).resolves.toEqual({ statusCode: 404, body: { error: "not_found" } })
  })
})

describe("in-flight dedupe", () => {
  function neverResolves(): Promise<never> {
    return new Promise<never>(() => {})
  }

  const renderBody = {
    kind: "render",
    jobId: "manager-job-render-1",
    assetId: "asset123",
    source: { url: "https://stream.mux.com/pb_abc.m3u8" },
    render: { mode: "preview", cropPlan: { assetId: "asset123" } },
  }

  it("includes crop plan artifact type and artifact suffix in render keys", () => {
    const legacy = jobRequestSchema.parse(renderBody)
    const attempt = jobRequestSchema.parse({
      ...renderBody,
      render: {
        ...renderBody.render,
        cropPlan: {
          assetId: "asset123",
          artifactType: "smart-crop-plan-9x16-attempt-001-v1",
        },
        artifactSuffix: "attempt-001",
      },
    })

    expect(jobDedupeKey(legacy)).toBe(
      "render:asset123:preview:asset123:smart-crop-plan-9x16-v1::",
    )
    expect(jobDedupeKey(attempt)).toBe(
      "render:asset123:preview:asset123:smart-crop-plan-9x16-attempt-001-v1::attempt-001",
    )
  })

  it("re-attaches a duplicate POST to the ACTIVE job (202 with the original workerJobId and current status)", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runFingerprintImpl: (async () =>
        neverResolves()) as unknown as typeof runFingerprint,
    })

    const first = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })
    expect(first.statusCode).toBe(202)
    await settle()

    // Same logical identity, even with a DIFFERENT manager jobId (a
    // re-launched workflow re-attaches too).
    const duplicate = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...fingerprintBody, jobId: "manager-job-relaunched" },
    })
    expect(duplicate.statusCode).toBe(202)
    expect(duplicate.body.workerJobId).toBe(first.body.workerJobId)
    expect(duplicate.body.status).toBe("running")
  })

  it("does not dedupe after the job completes or fails (manager resubmits intentionally)", async () => {
    let callCount = 0
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runFingerprintImpl: (async () => {
        callCount += 1
        if (callCount === 1) throw new Error("fingerprint exploded")
        return summary
      }) as typeof runFingerprint,
    })

    // First job fails — a rerun with the same identity must NOT dedupe.
    const failed = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })
    await settle()
    const afterFailed = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })
    expect(afterFailed.statusCode).toBe(202)
    expect(afterFailed.body.status).toBe("queued")
    expect(afterFailed.body.workerJobId).not.toBe(failed.body.workerJobId)

    // Second job completes — a rerun must NOT dedupe either.
    await settle()
    const afterCompleted = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })
    expect(afterCompleted.statusCode).toBe(202)
    expect(afterCompleted.body.workerJobId).not.toBe(
      afterFailed.body.workerJobId,
    )
  })

  it("does not dedupe render jobs across distinct modes", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runRenderImpl: (async () =>
        neverResolves()) as unknown as typeof runRender,
    })

    const preview = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: renderBody,
    })
    const full = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...renderBody, render: { ...renderBody.render, mode: "full" } },
    })

    expect(preview.statusCode).toBe(202)
    expect(full.statusCode).toBe(202)
    expect(full.body.workerJobId).not.toBe(preview.body.workerJobId)
  })

  it("does not dedupe render jobs across distinct attempt artifact inputs and suffixes", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runRenderImpl: (async () =>
        neverResolves()) as unknown as typeof runRender,
    })
    const attempt1 = {
      ...renderBody,
      render: {
        ...renderBody.render,
        cropPlan: {
          assetId: "asset123",
          artifactType: "smart-crop-plan-9x16-attempt-001-v1",
        },
        artifactSuffix: "attempt-001",
      },
    }
    const attempt2 = {
      ...renderBody,
      jobId: "manager-job-render-2",
      render: {
        ...renderBody.render,
        cropPlan: {
          assetId: "asset123",
          artifactType: "smart-crop-plan-9x16-attempt-002-v1",
        },
        artifactSuffix: "attempt-002",
      },
    }

    const first = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: attempt1,
    })
    const duplicate = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...attempt1, jobId: "manager-job-render-retry" },
    })
    const second = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: attempt2,
    })

    expect(first.statusCode).toBe(202)
    expect(duplicate.statusCode).toBe(202)
    expect(duplicate.body.workerJobId).toBe(first.body.workerJobId)
    expect(second.statusCode).toBe(202)
    expect(second.body.workerJobId).not.toBe(first.body.workerJobId)
  })

  it("does not collide fingerprint and render keys for the same assetId", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      runFingerprintImpl: (async () =>
        neverResolves()) as unknown as typeof runFingerprint,
      runRenderImpl: (async () =>
        neverResolves()) as unknown as typeof runRender,
    })

    const fingerprint = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })
    const render = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...renderBody, assetId: "asset123" },
    })

    expect(fingerprint.statusCode).toBe(202)
    expect(render.statusCode).toBe(202)
    expect(render.body.workerJobId).not.toBe(fingerprint.body.workerJobId)
  })
})

describe("source.url scheme validation", () => {
  it.each(["file:///app/.env", "http://169.254.169.254/latest/meta-data"])(
    "rejects %s with 400 in production",
    async (url) => {
      const handler = createHandleRequest({
        queue: createJobQueue({ concurrency: 1, limit: 10 }),
        auth,
        nodeEnv: "production",
      })

      await expect(
        dispatch(handler, {
          method: "POST",
          url: "/jobs",
          headers: authedHeaders,
          body: { ...fingerprintBody, source: { url } },
        }),
      ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })
    },
  )

  it("rejects unparseable URLs with 400 in production", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      nodeEnv: "production",
    })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        body: { ...fingerprintBody, source: { url: "not a url" } },
      }),
    ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })
  })

  it("accepts https URLs in production", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth,
      nodeEnv: "production",
      runFingerprintImpl: (async () => summary) as typeof runFingerprint,
    })

    const submitted = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })
    expect(submitted.statusCode).toBe(202)
  })

  it("accepts non-https strings outside production (local-path smokes)", async () => {
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 1, limit: 10 }),
      auth: { apiKeysCsv: "test-key", nodeEnv: "development" },
      nodeEnv: "development",
      runFingerprintImpl: (async () => summary) as typeof runFingerprint,
    })

    const submitted = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...fingerprintBody, source: { url: "/tmp/local-source.mp4" } },
    })
    expect(submitted.statusCode).toBe(202)
  })
})

describe("per-job deadline wiring", () => {
  it("threads an enqueue-time deadline into runFingerprint and runRender deps", async () => {
    const fingerprintInputs: Parameters<typeof runFingerprint>[0][] = []
    const renderInputs: RunRenderInput[] = []
    const handler = createHandleRequest({
      queue: createJobQueue({ concurrency: 2, limit: 10 }),
      auth,
      runFingerprintImpl: (async (input) => {
        fingerprintInputs.push(input)
        return summary
      }) as typeof runFingerprint,
      runRenderImpl: (async (input) => {
        renderInputs.push(input)
        return { artifacts: [], report: renderReport }
      }) as typeof runRender,
    })

    await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: fingerprintBody,
    })
    await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: {
        kind: "render",
        jobId: "manager-job-deadline",
        assetId: "asset456",
        source: { url: "https://stream.mux.com/pb_abc.m3u8" },
        render: { mode: "preview", cropPlan: { assetId: "asset123" } },
      },
    })
    await settle()

    expect(fingerprintInputs[0]?.deps?.deadline?.capTimeoutMs).toBeTypeOf(
      "function",
    )
    expect(renderInputs[0]?.deps?.deadline?.capTimeoutMs).toBeTypeOf("function")
    // Fresh deadlines: the default budgets leave (most of) the budget intact.
    expect(fingerprintInputs[0]!.deps!.deadline!.remainingMs()).toBeGreaterThan(
      0,
    )
  })
})
