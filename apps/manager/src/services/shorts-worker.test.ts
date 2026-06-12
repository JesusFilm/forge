import { describe, expect, it, vi } from "vitest"
import type { ShortRenderProps } from "@/lib/shorts-props"
import {
  getShortsWorkerJob,
  pollShortsWorkerJob,
  runShortsWorkerJob,
  SHORTS_PREPARE_POLL_TIMEOUT_MS,
  SHORTS_RENDER_POLL_TIMEOUT_MS,
  shortsWorkerDedupeKey,
  submitShortsWorkerJob,
  type ShortsWorkerJobSnapshot,
  type ShortsWorkerSubmitBody,
} from "@/services/shorts-worker"

const CLIENT = { baseUrl: "https://shorts-worker.internal", bearer: "secret" }

const instantSleep = async () => {}

const RENDER_PROPS: ShortRenderProps = {
  templateId: "focus",
  accentColor: "#facc15",
  captionPosition: "lower",
  captionFont: "montserrat",
  waveformStyle: "bars",
  showCaptions: true,
  captionPages: [],
  fps: 30,
  clipDurationSec: 30,
  hasAudio: true,
}

const PROPS_HASH = "a".repeat(64)

const PREPARE_BODY: ShortsWorkerSubmitBody = {
  kind: "prepare",
  jobId: "job-1",
  assetId: "mux-1-short-abc12345",
  source: { url: "https://stream.mux.com/pb.m3u8" },
  clip: { startSec: 10, endSec: 40 },
  transcription: { language: "en" },
}

const RENDER_BODY: ShortsWorkerSubmitBody = {
  kind: "render",
  jobId: "job-1",
  assetId: "mux-1-short-abc12345",
  propsHash: PROPS_HASH,
  draftVersion: 2,
  props: RENDER_PROPS,
}

function buildSnapshot(
  overrides: Partial<ShortsWorkerJobSnapshot> = {},
): ShortsWorkerJobSnapshot {
  return {
    workerJobId: "wj_1",
    kind: "prepare",
    status: "running",
    progress: 0.5,
    message: "Working",
    error: null,
    result: null,
    ...overrides,
  }
}

describe("shortsWorkerDedupeKey", () => {
  it("mirrors the worker's prepare key (assetId only, no jobId)", () => {
    expect(shortsWorkerDedupeKey(PREPARE_BODY)).toBe(
      "prepare:mux-1-short-abc12345",
    )
  })

  it("mirrors the worker's render key (assetId + propsHash)", () => {
    expect(shortsWorkerDedupeKey(RENDER_BODY)).toBe(
      `render:mux-1-short-abc12345:${PROPS_HASH}`,
    )
  })
})

describe("poll ceilings", () => {
  it("stay strictly above the worker's enqueue-time deadlines", () => {
    // Worker defaults: prepare 45min, render 70min (shorts-worker env).
    expect(SHORTS_PREPARE_POLL_TIMEOUT_MS).toBe(50 * 60_000)
    expect(SHORTS_RENDER_POLL_TIMEOUT_MS).toBe(80 * 60_000)
    expect(SHORTS_PREPARE_POLL_TIMEOUT_MS).toBeGreaterThan(2_700_000)
    expect(SHORTS_RENDER_POLL_TIMEOUT_MS).toBeGreaterThan(4_200_000)
  })
})

describe("submitShortsWorkerJob", () => {
  it("returns config_missing when the worker env is not set", async () => {
    await expect(submitShortsWorkerJob(PREPARE_BODY)).resolves.toMatchObject({
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
      submitShortsWorkerJob(PREPARE_BODY, { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      data: { workerJobId: "wj_1", status: "queued" },
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://shorts-worker.internal/jobs"),
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
    expect(sentBody).toEqual(PREPARE_BODY)
  })

  it("sends the full render body (propsHash + draftVersion + props)", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json(
          { workerJobId: "wj_r", status: "queued" },
          { status: 202 },
        ),
    )

    await submitShortsWorkerJob(RENDER_BODY, { ...CLIENT, fetchImpl })

    const sentBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>
    expect(sentBody).toEqual(RENDER_BODY)
    expect(sentBody).not.toHaveProperty("props.clipUrl")
  })

  it("maps 409 to queue_full", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "queue_full" }, { status: 409 }),
    )

    await expect(
      submitShortsWorkerJob(PREPARE_BODY, { ...CLIENT, fetchImpl }),
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
      submitShortsWorkerJob(PREPARE_BODY, { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })

  it("maps fetch timeouts to network_error with the timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("operation timed out"), {
        name: "TimeoutError",
      })
    })

    const result = await submitShortsWorkerJob(PREPARE_BODY, {
      ...CLIENT,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, reason: "network_error" })
    if (!result.ok) {
      expect(result.messages[0]).toContain("timed out")
    }
  })

  it("maps unexpected payloads to parse_error", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ nope: true }))

    await expect(
      submitShortsWorkerJob(PREPARE_BODY, { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({ ok: false, reason: "parse_error" })
  })

  it("maps 400 invalid_body to a non-retryable worker_error", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "invalid_body" }, { status: 400 }),
    )

    await expect(
      submitShortsWorkerJob(PREPARE_BODY, { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "worker_error",
      retryable: false,
    })
  })
})

describe("getShortsWorkerJob", () => {
  it("maps 404 to job_lost", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "not_found" }, { status: 404 }),
    )

    await expect(
      getShortsWorkerJob("wj_lost", { ...CLIENT, fetchImpl }),
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
        message: "Rendering frame 2268 of 5400",
        error: null,
        result: null,
      }),
    )

    await expect(
      getShortsWorkerJob("wj_1", { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      data: {
        workerJobId: "wj_1",
        kind: "render",
        status: "running",
        progress: 0.42,
        message: "Rendering frame 2268 of 5400",
        error: null,
        result: null,
      },
    })
  })

  it("parses the completion result artifacts and report", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        workerJobId: "wj_1",
        kind: "prepare",
        status: "completed",
        progress: 1,
        message: null,
        error: null,
        result: {
          artifacts: [
            {
              assetId: "mux-1-short-abc12345",
              artifactType: "shorts-clip-v1",
              ext: "mp4",
            },
          ],
          report: {
            hasAudio: true,
            clipDurationSec: 30,
            captionsCount: 55,
            annotation: null,
          },
        },
      }),
    )

    const result = await getShortsWorkerJob("wj_1", { ...CLIENT, fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.result?.artifacts).toEqual([
        {
          assetId: "mux-1-short-abc12345",
          artifactType: "shorts-clip-v1",
          ext: "mp4",
        },
      ])
      expect(result.data.result?.report).toMatchObject({ captionsCount: 55 })
    }
  })

  it("parses the structured failure error envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        buildSnapshot({
          status: "failed",
          error: {
            reason: "clip_out_of_range",
            messages: ["clip bounds exceed source duration"],
            retryable: false,
          },
        }),
      ),
    )

    const result = await getShortsWorkerJob("wj_1", { ...CLIENT, fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.error).toEqual({
        reason: "clip_out_of_range",
        messages: ["clip bounds exceed source duration"],
        retryable: false,
      })
    }
  })

  it("rejects a present-but-malformed error object as parse_error (contract drift)", async () => {
    // Same policy as a malformed result: silently nulling the envelope would
    // hide a worker contract drift behind "failed without an envelope".
    const fetchImpl = vi.fn(async () =>
      Response.json({
        ...buildSnapshot({ status: "failed" }),
        error: { reason: "render_failed", messages: "not-an-array" },
      }),
    )

    await expect(
      getShortsWorkerJob("wj_1", { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})

describe("pollShortsWorkerJob", () => {
  it("polls until completion and reports progress", async () => {
    const snapshots = [
      buildSnapshot({ status: "queued", progress: null }),
      buildSnapshot({ status: "running", progress: 0.5 }),
      buildSnapshot({ status: "completed", progress: 1 }),
    ]
    let call = 0
    const fetchImpl = vi.fn(async () => Response.json(snapshots[call++]))
    const onProgress = vi.fn()

    const result = await pollShortsWorkerJob(
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

  it("classifies a failed job via the worker's structured envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        buildSnapshot({
          status: "failed",
          error: {
            reason: "render_failed",
            messages: ["Chromium crashed"],
            retryable: true,
          },
        }),
      ),
    )

    await expect(
      pollShortsWorkerJob(
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
      messages: ["render_failed: Chromium crashed"],
      retryable: true,
    })
  })

  it("defaults a failed job without an envelope to non-retryable", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(buildSnapshot({ status: "failed", error: null })),
    )

    await expect(
      pollShortsWorkerJob(
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
      messages: ["shorts-worker job failed"],
      retryable: false,
    })
  })

  it("returns timeout when the deadline is exceeded", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(buildSnapshot({ status: "running" })),
    )

    const result = await pollShortsWorkerJob(
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

  it("keeps polling through transient parse errors until the deadline", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return Response.json({ garbage: true })
      }
      return Response.json(buildSnapshot({ status: "completed" }))
    })

    await expect(
      pollShortsWorkerJob(
        {
          workerJobId: "wj_1",
          intervalMs: 1_000,
          timeoutMs: 60_000,
          sleep: instantSleep,
        },
        { ...CLIENT, fetchImpl },
      ),
    ).resolves.toMatchObject({ ok: true, data: { status: "completed" } })
  })

  it("returns job_lost immediately so the caller can resubmit", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "not_found" }, { status: 404 }),
    )

    await expect(
      pollShortsWorkerJob(
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

describe("runShortsWorkerJob", () => {
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
        return Response.json({ error: "not_found" }, { status: 404 })
      },
    )

    const result = await runShortsWorkerJob(
      {
        body: RENDER_BODY,
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

    const result = await runShortsWorkerJob(
      {
        body: PREPARE_BODY,
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

    const result = await runShortsWorkerJob(
      {
        body: PREPARE_BODY,
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
          return Response.json({ error: "not_found" }, { status: 404 })
        }
        return Response.json(buildSnapshot({ status: "completed" }))
      },
    )

    const result = await runShortsWorkerJob(
      {
        body: PREPARE_BODY,
        pollTimeoutMs: 60_000,
        intervalMs: 1_000,
        sleep: instantSleep,
      },
      { ...CLIENT, fetchImpl },
    )

    expect(result).toMatchObject({ ok: true, data: { status: "completed" } })
  })
})
