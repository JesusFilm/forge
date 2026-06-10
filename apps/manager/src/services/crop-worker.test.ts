import { describe, expect, it, vi } from "vitest"
import {
  getCropWorkerJob,
  pollCropWorkerJob,
  runCropWorkerJob,
  submitCropWorkerJob,
  type CropWorkerJobSnapshot,
} from "@/services/crop-worker"

const CLIENT = { baseUrl: "https://crop-worker.internal", bearer: "secret" }

const instantSleep = async () => {}

function buildSnapshot(
  overrides: Partial<CropWorkerJobSnapshot> = {},
): CropWorkerJobSnapshot {
  return {
    workerJobId: "wj_1",
    kind: "fingerprint",
    status: "running",
    progress: 0.5,
    message: "Working",
    error: null,
    result: null,
    ...overrides,
  }
}

describe("submitCropWorkerJob", () => {
  const body = {
    kind: "fingerprint" as const,
    jobId: "job-1",
    assetId: "asset-1",
    source: { url: "https://stream.mux.com/pb.m3u8" },
  }

  it("returns config_missing when the worker env is not set", async () => {
    await expect(submitCropWorkerJob(body)).resolves.toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("submits with the bearer and parses the accepted payload", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json(
          { workerJobId: "wj_1", status: "queued" },
          { status: 202 },
        ),
    )

    await expect(
      submitCropWorkerJob(body, { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      data: { workerJobId: "wj_1", status: "queued" },
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://crop-worker.internal/jobs"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    )
    const sentBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>
    expect(sentBody).toEqual(body)
  })

  it("maps 409 to queue_full", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "queue_full" }, { status: 409 }),
    )

    await expect(
      submitCropWorkerJob(body, { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "queue_full",
      retryable: true,
    })
  })

  it("maps network failures to network_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hang up")
    })

    await expect(
      submitCropWorkerJob(body, { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })

  it("maps unexpected payloads to parse_error", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ nope: true }))

    await expect(
      submitCropWorkerJob(body, { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({ ok: false, reason: "parse_error" })
  })
})

describe("getCropWorkerJob", () => {
  it("maps 404 to job_lost", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "not found" }, { status: 404 }),
    )

    await expect(
      getCropWorkerJob("wj_lost", { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "job_lost",
      retryable: true,
    })
  })

  it("parses a running snapshot including null result", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        workerJobId: "wj_1",
        kind: "render",
        status: "running",
        progress: 0.42,
        message: "Rendering segment 42 of 100",
        error: null,
        result: null,
      }),
    )

    await expect(
      getCropWorkerJob("wj_1", { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      data: {
        workerJobId: "wj_1",
        kind: "render",
        status: "running",
        progress: 0.42,
        message: "Rendering segment 42 of 100",
        error: null,
        result: null,
      },
    })
  })

  it("parses the completion result artifacts", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        workerJobId: "wj_1",
        kind: "fingerprint",
        status: "completed",
        progress: 1,
        message: null,
        error: null,
        result: {
          artifacts: [
            {
              assetId: "asset-1",
              artifactType: "smart-crop-fingerprint-v1",
              ext: "json",
            },
          ],
          report: { shots: 12 },
        },
      }),
    )

    const result = await getCropWorkerJob("wj_1", { ...CLIENT, fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.result?.artifacts).toEqual([
        {
          assetId: "asset-1",
          artifactType: "smart-crop-fingerprint-v1",
          ext: "json",
        },
      ])
    }
  })
})

describe("pollCropWorkerJob", () => {
  it("polls until completion and reports progress", async () => {
    const snapshots = [
      buildSnapshot({ status: "queued", progress: null }),
      buildSnapshot({ status: "running", progress: 0.5 }),
      buildSnapshot({ status: "completed", progress: 1 }),
    ]
    let call = 0
    const fetchImpl = vi.fn(async () => Response.json(snapshots[call++]))
    const onProgress = vi.fn()

    const result = await pollCropWorkerJob(
      {
        workerJobId: "wj_1",
        onProgress,
        intervalMs: 1_000,
        timeoutMs: 60_000,
        sleep: instantSleep,
      },
      { ...CLIENT, fetchImpl },
    )

    expect(result).toMatchObject({ ok: true, data: { status: "completed" } })
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it("returns worker_error when the job fails", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        buildSnapshot({ status: "failed", error: "ffmpeg exited 1" }),
      ),
    )

    await expect(
      pollCropWorkerJob(
        {
          workerJobId: "wj_1",
          intervalMs: 1_000,
          timeoutMs: 60_000,
          sleep: instantSleep,
        },
        { ...CLIENT, fetchImpl },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "worker_error",
      messages: ["ffmpeg exited 1"],
      retryable: false,
    })
  })

  it("returns timeout when the deadline is exceeded", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(buildSnapshot({ status: "running" })),
    )

    const result = await pollCropWorkerJob(
      {
        workerJobId: "wj_1",
        intervalMs: 1_000,
        timeoutMs: 3_000,
        sleep: instantSleep,
      },
      { ...CLIENT, fetchImpl },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "timeout",
      retryable: false,
    })
    // initial poll + one per accumulated interval until the deadline
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("returns job_lost immediately so the caller can resubmit", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "unknown" }, { status: 404 }),
    )

    await expect(
      pollCropWorkerJob(
        {
          workerJobId: "wj_gone",
          intervalMs: 1_000,
          timeoutMs: 60_000,
          sleep: instantSleep,
        },
        { ...CLIENT, fetchImpl },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "job_lost" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe("runCropWorkerJob", () => {
  const body = {
    kind: "render" as const,
    jobId: "job-1",
    assetId: "asset-1",
    source: { url: "https://stream.mux.com/pb.m3u8" },
    render: {
      mode: "preview" as const,
      cropPlan: { assetId: "asset-canonical" },
      previewFrameCount: 6,
    },
  }

  it("resubmits when the worker loses the job, bounded twice", async () => {
    // Each submission accepted; every status poll 404s -> 3 total submissions.
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Response.json(
            {
              workerJobId: `wj_${fetchImpl.mock.calls.length}`,
              status: "queued",
            },
            { status: 202 },
          )
        }
        return Response.json({ error: "unknown" }, { status: 404 })
      },
    )

    const result = await runCropWorkerJob(
      {
        body,
        pollTimeoutMs: 60_000,
        intervalMs: 1_000,
        sleep: instantSleep,
      },
      { ...CLIENT, fetchImpl },
    )

    // retryable flipped to false after the bounded resubmit budget is
    // exhausted: the resubmit loop IS the retry policy for job_lost, so
    // workflow steps must not compound it with their own retries.
    expect(result).toMatchObject({
      ok: false,
      reason: "job_lost",
      retryable: false,
    })
    const submissions = fetchImpl.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    )
    expect(submissions).toHaveLength(3)
  })

  it("waits out queue_full responses and resubmits until accepted", async () => {
    let posts = 0
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts += 1
          if (posts <= 2) {
            return Response.json({ error: "queue_full" }, { status: 409 })
          }
          return Response.json(
            { workerJobId: "wj_after_wait", status: "queued" },
            { status: 202 },
          )
        }
        return Response.json(buildSnapshot({ status: "completed" }))
      },
    )
    const sleep = vi.fn(async (_ms: number) => {})

    const result = await runCropWorkerJob(
      {
        body,
        pollTimeoutMs: 60_000,
        intervalMs: 1_000,
        sleep,
      },
      { ...CLIENT, fetchImpl },
    )

    expect(result).toMatchObject({ ok: true, data: { status: "completed" } })
    expect(posts).toBe(3)
    // One 30s wait per queue_full response before resubmitting.
    expect(sleep.mock.calls.filter(([ms]) => ms === 30_000)).toHaveLength(2)
  })

  it("fails with queue_full only after exhausting the bounded waits", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "queue_full" }, { status: 409 }),
    )

    const result = await runCropWorkerJob(
      {
        body,
        pollTimeoutMs: 60_000,
        intervalMs: 1_000,
        sleep: instantSleep,
      },
      { ...CLIENT, fetchImpl },
    )

    expect(result).toMatchObject({ ok: false, reason: "queue_full" })
    // Initial submit + 10 bounded queue_full retries, no further attempts.
    expect(fetchImpl).toHaveBeenCalledTimes(11)
  })

  it("recovers when a resubmitted job completes", async () => {
    let polls = 0
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Response.json(
            { workerJobId: "wj_retry", status: "queued" },
            { status: 202 },
          )
        }
        polls += 1
        if (polls === 1) {
          return Response.json({ error: "unknown" }, { status: 404 })
        }
        return Response.json(buildSnapshot({ status: "completed" }))
      },
    )

    const result = await runCropWorkerJob(
      {
        body,
        pollTimeoutMs: 60_000,
        intervalMs: 1_000,
        sleep: instantSleep,
      },
      { ...CLIENT, fetchImpl },
    )

    expect(result).toMatchObject({ ok: true, data: { status: "completed" } })
  })
})
