import type { IncomingMessage } from "node:http"
import { Readable, Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import { createJobLanes } from "../jobs.js"
import type {
  runDevotionalRender,
  RunDevotionalRenderInput,
} from "../devotional-render.js"
import type { runPrepare, RunPrepareInput } from "../prepare.js"
import type { runRender, RunRenderInput } from "../render.js"
import { createHandleRequest } from "../server.js"
import type { PrepareReport, RenderReport } from "../types.js"

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

const prepareReport: PrepareReport = {
  hasAudio: true,
  clipDurationSec: 10,
  captionsCount: 4,
  annotation: null,
}

const renderReport: RenderReport = {
  outputDurationSec: 10.1,
  width: 1080,
  height: 1920,
}

const validProps = {
  templateId: "focus",
  accentColor: "#FFC83D",
  captionPosition: "center",
  captionFont: "montserrat",
  waveformStyle: "bars",
  showCaptions: true,
  captionPages: [
    {
      text: "Hello",
      startMs: 0,
      durationMs: 900,
      tokens: [{ text: "Hello", fromMs: 0, toMs: 900 }],
    },
  ],
  fps: 30,
  clipDurationSec: 10,
  hasAudio: true,
}

const prepareBody = {
  kind: "prepare",
  jobId: "manager-job-1",
  assetId: "muxasset1-short-ab12cd34",
  source: { url: "https://stream.mux.com/pb_abc.m3u8" },
  clip: { startSec: 5, endSec: 15 },
  transcription: { language: "en" },
}

const renderBody = {
  kind: "render",
  jobId: "manager-job-2",
  assetId: "muxasset1-short-ab12cd34",
  propsHash: "f".repeat(64),
  draftVersion: 2,
  props: validProps,
}

const devotionalRenderBody = {
  kind: "devotional-render",
  jobId: "manager-job-devotional",
  runId: "mastra-run-1",
  inputAssetId: "devotional-input-run-1",
  outputAssetId: "devotional-output-run-1",
  inputHash: "a".repeat(64),
}

const authedHeaders = { authorization: "Bearer test-key" }
const auth = { apiKeysCsv: "test-key", nodeEnv: "production" }

function buildHandler(overrides?: Parameters<typeof createHandleRequest>[0]) {
  return createHandleRequest({
    queue: createJobLanes({
      prepare: { concurrency: 1, limit: 2 },
      render: { concurrency: 1, limit: 2 },
    }),
    auth,
    runPrepareImpl: (async () => ({
      artifacts: [],
      report: prepareReport,
    })) as typeof runPrepare,
    runRenderImpl: (async () => ({
      artifacts: [],
      report: renderReport,
    })) as typeof runRender,
    ...overrides,
  })
}

describe("auth", () => {
  it("returns 401 unauthorized for a missing or wrong bearer", async () => {
    const handler = buildHandler()

    await expect(
      dispatch(handler, { method: "POST", url: "/jobs", body: prepareBody }),
    ).resolves.toEqual({ statusCode: 401, body: { error: "unauthorized" } })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: { authorization: "Bearer wrong" },
        body: prepareBody,
      }),
    ).resolves.toEqual({ statusCode: 401, body: { error: "unauthorized" } })
  })

  it("returns 503 config_missing in production when the allowlist is unset", async () => {
    const handler = buildHandler({
      auth: { apiKeysCsv: undefined, nodeEnv: "production" },
    })

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        body: prepareBody,
      }),
    ).resolves.toEqual({ statusCode: 503, body: { error: "config_missing" } })
  })

  it("also guards GET /jobs/{id}", async () => {
    const handler = buildHandler()

    await expect(
      dispatch(handler, { method: "GET", url: "/jobs/wj_x" }),
    ).resolves.toEqual({ statusCode: 401, body: { error: "unauthorized" } })
  })
})

describe("POST /jobs validation", () => {
  it("rejects schema-invalid bodies with 400", async () => {
    const handler = buildHandler()

    const invalidBodies: unknown[] = [
      { kind: "transcode", assetId: "x" },
      // Unsafe assetId (slash) — must fail the SAFE pattern.
      { ...prepareBody, assetId: "../escape" },
      // endSec <= startSec.
      { ...prepareBody, clip: { startSec: 15, endSec: 15 } },
      // Missing transcription.
      { ...prepareBody, transcription: undefined },
      // Bad propsHash (uppercase / wrong length).
      { ...renderBody, propsHash: "F".repeat(64) },
      { ...renderBody, propsHash: "abc123" },
      // Non-integer draftVersion.
      { ...renderBody, draftVersion: 1.5 },
      // Props failing the compositions schema (bad accent color).
      { ...renderBody, props: { ...validProps, accentColor: "red" } },
      // Props missing a server-injected field the worker requires.
      { ...renderBody, props: { ...validProps, clipDurationSec: undefined } },
    ]

    for (const body of invalidBodies) {
      await expect(
        dispatch(handler, {
          method: "POST",
          url: "/jobs",
          headers: authedHeaders,
          body,
        }),
        JSON.stringify(body),
      ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })
    }
  })

  it("strips a smuggled clipUrl from render props (server-injected only)", async () => {
    const inputs: RunRenderInput[] = []
    const handler = buildHandler({
      runRenderImpl: (async (input: RunRenderInput) => {
        inputs.push(input)
        return { artifacts: [], report: renderReport }
      }) as typeof runRender,
    })

    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: {
        ...renderBody,
        props: { ...validProps, clipUrl: "https://evil.example/x.mp4" },
      },
    })
    expect(submit.statusCode).toBe(202)
    await settle()

    expect(inputs).toHaveLength(1)
    expect("clipUrl" in (inputs[0]!.props as Record<string, unknown>)).toBe(
      false,
    )
  })

  it("rejects non-JSON content types and malformed JSON with 400", async () => {
    const handler = buildHandler()

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        rawBody: "kind=prepare",
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

  it("rejects bodies over the 1MB cap with 413", async () => {
    const handler = buildHandler()

    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        rawBody: `{"pad":"${"x".repeat(1_000_001)}"}`,
      }),
    ).resolves.toEqual({ statusCode: 413, body: { error: "body_too_large" } })
  })

  it("rejects a non-allowlisted prepare source with 400 BEFORE enqueueing", async () => {
    let prepareCalls = 0
    const handler = buildHandler({
      nodeEnv: "production",
      allowedSourceHosts: ["stream.mux.com"],
      runPrepareImpl: (async () => {
        prepareCalls += 1
        return { artifacts: [], report: prepareReport }
      }) as typeof runPrepare,
    })

    for (const url of [
      "https://stream.mux.com.evil.com/x.m3u8",
      "https://169.254.169.254/x",
      "file:///etc/passwd",
      "http://stream.mux.com/x.m3u8",
    ]) {
      await expect(
        dispatch(handler, {
          method: "POST",
          url: "/jobs",
          headers: authedHeaders,
          body: { ...prepareBody, source: { url } },
        }),
        url,
      ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })
    }
    await settle()
    expect(prepareCalls).toBe(0)
  })
})

describe("prepare job lifecycle", () => {
  it("accepts with 202 and completes with the contract snapshot shape", async () => {
    const inputs: RunPrepareInput[] = []
    const handler = buildHandler({
      runPrepareImpl: (async (input: RunPrepareInput) => {
        inputs.push(input)
        return {
          artifacts: [
            {
              assetId: input.assetId,
              artifactType: "shorts-clip-v1",
              ext: "mp4",
            },
          ],
          report: prepareReport,
        }
      }) as typeof runPrepare,
    })

    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: prepareBody,
    })

    expect(submit.statusCode).toBe(202)
    expect(submit.body.status).toBe("queued")
    const workerJobId = submit.body.workerJobId as string
    expect(workerJobId).toMatch(/^wj_/)

    await settle()
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      assetId: "muxasset1-short-ab12cd34",
      sourceUrl: "https://stream.mux.com/pb_abc.m3u8",
      clip: { startSec: 5, endSec: 15 },
      language: "en",
    })
    expect(inputs[0]!.deps?.deadline?.capTimeoutMs).toBeTypeOf("function")
    expect(inputs[0]!.deps!.deadline!.remainingMs()).toBeGreaterThan(0)

    const status = await dispatch(handler, {
      method: "GET",
      url: `/jobs/${workerJobId}`,
      headers: authedHeaders,
    })

    expect(status.statusCode).toBe(200)
    expect(status.body).toEqual({
      workerJobId,
      kind: "prepare",
      status: "completed",
      progress: 1,
      message: null,
      error: null,
      result: {
        artifacts: [
          {
            assetId: "muxasset1-short-ab12cd34",
            artifactType: "shorts-clip-v1",
            ext: "mp4",
          },
        ],
        report: prepareReport,
      },
    })
  })

  it("passes a null language through (unsupported-language path)", async () => {
    const inputs: RunPrepareInput[] = []
    const handler = buildHandler({
      runPrepareImpl: (async (input: RunPrepareInput) => {
        inputs.push(input)
        return { artifacts: [], report: prepareReport }
      }) as typeof runPrepare,
    })

    await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...prepareBody, transcription: { language: null } },
    })
    await settle()

    expect(inputs[0]!.language).toBeNull()
  })
})

describe("render job lifecycle", () => {
  it("maps the request body onto runRender input (propsHash opaque passthrough)", async () => {
    const inputs: RunRenderInput[] = []
    const handler = buildHandler({
      runRenderImpl: (async (input: RunRenderInput) => {
        inputs.push(input)
        return { artifacts: [], report: renderReport }
      }) as typeof runRender,
    })

    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: renderBody,
    })
    expect(submit.statusCode).toBe(202)
    await settle()

    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      assetId: "muxasset1-short-ab12cd34",
      propsHash: "f".repeat(64),
      draftVersion: 2,
    })
    expect(inputs[0]!.props.templateId).toBe("focus")
    expect(inputs[0]!.deps?.deadline?.capTimeoutMs).toBeTypeOf("function")
  })

  it("surfaces a STRUCTURED error through GET /jobs/{id} on failure", async () => {
    const handler = buildHandler({
      runRenderImpl: (async () => {
        throw new Error("renderMedia exploded")
      }) as typeof runRender,
    })

    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: renderBody,
    })
    await settle()

    const status = await dispatch(handler, {
      method: "GET",
      url: `/jobs/${submit.body.workerJobId as string}`,
      headers: authedHeaders,
    })

    expect(status.body.status).toBe("failed")
    expect(status.body.error).toEqual({
      reason: "internal_error",
      messages: ["renderMedia exploded"],
      retryable: false,
    })
    expect(status.body.result).toBeNull()
  })
})

describe("devotional render job lifecycle", () => {
  it("requires auth and rejects unsafe identifiers", async () => {
    const handler = buildHandler()
    await expect(
      dispatch(handler, {
        method: "POST",
        url: "/jobs",
        body: devotionalRenderBody,
      }),
    ).resolves.toEqual({ statusCode: 401, body: { error: "unauthorized" } })

    for (const body of [
      { ...devotionalRenderBody, runId: "../run" },
      { ...devotionalRenderBody, inputAssetId: "input/path" },
      { ...devotionalRenderBody, outputAssetId: "output%2Fpath" },
      { ...devotionalRenderBody, inputHash: "not-a-hash" },
    ]) {
      await expect(
        dispatch(handler, {
          method: "POST",
          url: "/jobs",
          headers: authedHeaders,
          body,
        }),
      ).resolves.toEqual({ statusCode: 400, body: { error: "invalid_body" } })
    }
  })

  it("returns stable portrait and wide artifact refs", async () => {
    const inputs: RunDevotionalRenderInput[] = []
    const handler = buildHandler({
      runDevotionalRenderImpl: (async (input: RunDevotionalRenderInput) => {
        inputs.push(input)
        const portrait = {
          artifact: {
            assetId: input.outputAssetId,
            artifactType: "devotional-output-portrait-v1",
            ext: "mp4",
          },
          outputDurationSec: 60,
          width: 1080,
          height: 1920,
        }
        const wide = {
          artifact: {
            assetId: input.outputAssetId,
            artifactType: "devotional-output-wide-v1",
            ext: "mp4",
          },
          outputDurationSec: 60,
          width: 1920,
          height: 1080,
        }
        return {
          artifacts: [portrait.artifact, wide.artifact],
          report: { portrait, wide },
        }
      }) as typeof runDevotionalRender,
    })
    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: devotionalRenderBody,
    })
    await settle()
    const status = await dispatch(handler, {
      method: "GET",
      url: `/jobs/${submit.body.workerJobId as string}`,
      headers: authedHeaders,
    })
    expect(inputs[0]).toMatchObject({
      runId: "mastra-run-1",
      inputAssetId: "devotional-input-run-1",
      outputAssetId: "devotional-output-run-1",
      inputHash: "a".repeat(64),
    })
    expect(status.body).toMatchObject({
      kind: "devotional-render",
      status: "completed",
      result: {
        report: {
          portrait: { width: 1080, height: 1920 },
          wide: { width: 1920, height: 1080 },
        },
      },
    })
  })

  it("dedupes active devotional renders by output asset and input hash", async () => {
    const handler = buildHandler({
      runDevotionalRenderImpl: (async () =>
        new Promise(() => {})) as unknown as typeof runDevotionalRender,
    })
    const first = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: devotionalRenderBody,
    })
    await settle()
    const duplicate = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...devotionalRenderBody, runId: "mastra-run-restarted" },
    })
    expect(duplicate.body.workerJobId).toBe(first.body.workerJobId)
  })

  it("cancels an active devotional render through the authenticated job route", async () => {
    const handler = buildHandler({
      runDevotionalRenderImpl: (async (input: RunDevotionalRenderInput) =>
        new Promise((_resolve, reject) => {
          input.deps?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          )
        })) as typeof runDevotionalRender,
    })
    const submit = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: devotionalRenderBody,
    })
    await settle()
    const workerJobId = submit.body.workerJobId as string
    const cancelled = await dispatch(handler, {
      method: "DELETE",
      url: `/jobs/${workerJobId}`,
      headers: authedHeaders,
    })
    expect(cancelled).toEqual({
      statusCode: 202,
      body: { workerJobId, status: "cancelled" },
    })
    await settle()
    const status = await dispatch(handler, {
      method: "GET",
      url: `/jobs/${workerJobId}`,
      headers: authedHeaders,
    })
    expect(status.body).toMatchObject({
      status: "cancelled",
      error: null,
      result: null,
    })
  })
})

describe("queue limits, dedupe, unknown jobs", () => {
  it("returns 409 queue_full when a lane is at its cap", async () => {
    const handler = buildHandler({
      runPrepareImpl: (async () =>
        new Promise(() => {})) as unknown as typeof runPrepare,
    })

    // Lane limit 2: running + queued. Distinct assetIds — identical bodies
    // would re-attach (dedupe) instead of exercising the bound.
    for (const [index, assetId] of ["asset-a", "asset-b"].entries()) {
      const accepted = await dispatch(handler, {
        method: "POST",
        url: "/jobs",
        headers: authedHeaders,
        body: { ...prepareBody, assetId },
      })
      expect(accepted.statusCode, `submission ${index}`).toBe(202)
    }

    const rejected = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...prepareBody, assetId: "asset-c" },
    })
    expect(rejected).toEqual({
      statusCode: 409,
      body: { error: "queue_full" },
    })

    // The render lane is unaffected.
    const render = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: renderBody,
    })
    expect(render.statusCode).toBe(202)
  })

  it("re-attaches a duplicate render POST to the ACTIVE job (same propsHash, different jobId)", async () => {
    const handler = buildHandler({
      runRenderImpl: (async () =>
        new Promise(() => {})) as unknown as typeof runRender,
    })

    const first = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: renderBody,
    })
    expect(first.statusCode).toBe(202)
    await settle()

    const duplicate = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...renderBody, jobId: "manager-job-relaunched" },
    })
    expect(duplicate.statusCode).toBe(202)
    expect(duplicate.body.workerJobId).toBe(first.body.workerJobId)
    expect(duplicate.body.status).toBe("running")

    // A DIFFERENT propsHash is a new logical job (re-render after an edit).
    const edited = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: { ...renderBody, propsHash: "0".repeat(64) },
    })
    expect(edited.statusCode).toBe(202)
    expect(edited.body.workerJobId).not.toBe(first.body.workerJobId)
  })

  it("does not dedupe after completion (manager resubmits intentionally)", async () => {
    const handler = buildHandler()

    const first = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: renderBody,
    })
    await settle()

    const second = await dispatch(handler, {
      method: "POST",
      url: "/jobs",
      headers: authedHeaders,
      body: renderBody,
    })
    expect(second.statusCode).toBe(202)
    expect(second.body.workerJobId).not.toBe(first.body.workerJobId)
  })

  it("returns 404 for unknown worker job ids", async () => {
    const handler = buildHandler()

    await expect(
      dispatch(handler, {
        method: "GET",
        url: "/jobs/wj_unknown",
        headers: authedHeaders,
      }),
    ).resolves.toEqual({ statusCode: 404, body: { error: "not_found" } })
  })
})
