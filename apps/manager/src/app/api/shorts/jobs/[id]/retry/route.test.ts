import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord, JobStepState, ShortsPhase } from "@/types/job"

const {
  authenticateManagerOverrideRequestMock,
  getJobMock,
  updateJobMock,
  launchShortsMock,
} = vi.hoisted(() => ({
  authenticateManagerOverrideRequestMock: vi.fn(),
  getJobMock: vi.fn(),
  updateJobMock: vi.fn(),
  launchShortsMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateManagerOverrideRequest: authenticateManagerOverrideRequestMock,
  managerActorIdentity: (actor: {
    kind: string
    user?: { email: string }
    approvedByUserId: string
  }) =>
    actor.kind === "session"
      ? actor.user?.email || actor.approvedByUserId
      : actor.approvedByUserId,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  updateJob: updateJobMock,
}))

vi.mock("@/workflows/launchShorts", () => ({
  launchShorts: launchShortsMock,
}))

vi.mock("@/config/env", () => ({
  env: {} as Record<string, string | undefined>,
}))

const { env } = await import("@/config/env")
const { clearShortsLaunchSlots } = await import("@/lib/shorts-claim")
const { POST } = await import("@/app/api/shorts/jobs/[id]/retry/route")

const envMutable = env as unknown as Record<string, string | undefined>

function buildShortsJob(
  phase: ShortsPhase,
  overrides: Partial<JobRecord> = {},
): JobRecord {
  const steps: JobStepState[] = [
    {
      name: "shorts_prepare",
      status: phase === "prepare_failed" ? "failed" : "completed",
      retries: 0,
      ...(phase === "prepare_failed" ? { error: "whisper failed" } : {}),
    },
  ]

  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pbpublic",
    languages: [],
    options: {
      shorts: {
        assetId: "mux-1-short-abcd1234",
        sourceMuxAssetId: "mux-1",
        sourcePlaybackId: "pbpublic",
        clip: { startSec: 10, endSec: 40 },
        language: { bcp47: "en", whisper: "en" },
      },
    },
    status: phase.endsWith("_failed") ? "failed" : "completed",
    retries: 0,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    artifacts: {
      shorts: {
        kind: "metadata",
        data: {
          domain: "shorts",
          phase,
          annotation: null,
          hasAudio: true,
          clipDurationSec: 30,
          captionsCount: 42,
          draftVersion: 2,
          lastRenderedDraftVersion: null,
          lastRenderedPropsHash: null,
          output: { muxAssetId: null, playbackId: null, ready: false },
          updatedAt: "2026-06-11T00:00:00.000Z",
        },
      },
    },
    steps,
    errors: [],
    ...overrides,
  }
}

function postRequest(body?: unknown): Request {
  return new Request("http://example.test/api/shorts/jobs/job-1/retry", {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }
      : {}),
  })
}

const routeParams = { params: Promise.resolve({ id: "job-1" }) }

const sessionActor = {
  kind: "session" as const,
  user: {
    id: "user-1",
    username: "op",
    email: "op@jesusfilm.org",
    role: { name: "Manager" as const, type: "manager" as const },
  },
  approvedByUserId: "user-1",
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-06-11T00:04:00.000Z"))
  authenticateManagerOverrideRequestMock.mockReset()
  getJobMock.mockReset()
  updateJobMock.mockReset()
  launchShortsMock.mockReset()
  clearShortsLaunchSlots()

  authenticateManagerOverrideRequestMock.mockResolvedValue(sessionActor)
  getJobMock.mockResolvedValue(buildShortsJob("prepare_failed"))
  updateJobMock.mockResolvedValue(buildShortsJob("prepare_failed"))
  launchShortsMock.mockResolvedValue(undefined)

  envMutable.SHORTS_WORKER_BASE_URL = "https://shorts-worker.internal"
  envMutable.SHORTS_WORKER_API_KEY = "shorts-key"
})

afterEach(() => {
  vi.useRealTimers()
})

describe("POST /api/shorts/jobs/[id]/retry", () => {
  it("rejects unauthorized callers", async () => {
    const { NextResponse } = await import("next/server")
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      NextResponse.json(
        { error: "Interactive Manager session or API key required" },
        { status: 403 },
      ),
    )

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(403)
    expect(launchShortsMock).not.toHaveBeenCalled()
  })

  it("returns 404 for unknown jobs", async () => {
    getJobMock.mockResolvedValue(null)

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(404)
  })

  it("returns 409 not_shorts_job for non-shorts jobs", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob("prepare_failed", { options: {} }),
    )

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      reason: "not_shorts_job",
    })
  })

  it("returns 400 for invalid bodies", async () => {
    const invalidJson = await POST(postRequest("{not json"), routeParams)
    expect(invalidJson.status).toBe(400)

    const invalidForce = await POST(postRequest({ force: "yes" }), routeParams)
    expect(invalidForce.status).toBe(400)
    expect(launchShortsMock).not.toHaveBeenCalled()
  })

  it("relaunches prepare (no force) from prepare_failed", async () => {
    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      launched: true,
      kind: "prepare",
    })
    expect(launchShortsMock).toHaveBeenCalledWith("prepare", "job-1")
  })

  it.each<ShortsPhase>(["render_failed", "completed", "ready_for_review"])(
    "relaunches render (plain retry) from phase %s",
    async (phase) => {
      getJobMock.mockResolvedValue(buildShortsJob(phase))

      const response = await POST(postRequest(), routeParams)
      expect(response.status).toBe(202)
      await expect(response.json()).resolves.toEqual({
        launched: true,
        kind: "render",
      })
      expect(launchShortsMock).toHaveBeenCalledWith("render", "job-1")
    },
  )

  it.each<ShortsPhase>(["queued", "preparing", "rendering", "mux_processing"])(
    "rejects plain retries with 409 phase_invalid during phase %s",
    async (phase) => {
      getJobMock.mockResolvedValue(buildShortsJob(phase))

      const response = await POST(postRequest(), routeParams)
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        reason: "phase_invalid",
        phase,
        error: expect.stringContaining("while a workflow is running"),
      })
      expect(launchShortsMock).not.toHaveBeenCalled()
    },
  )

  it("relaunches prepare for a launch-failed job (phase queued, status failed)", async () => {
    // The create route's workflow launch failed before any phase transition:
    // the report still says "queued" but the job is failed. A plain retry
    // must relaunch prepare instead of returning a permanent 409 (todo 010).
    getJobMock.mockResolvedValue(buildShortsJob("queued", { status: "failed" }))

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      launched: true,
      kind: "prepare",
    })
    expect(launchShortsMock).toHaveBeenCalledWith("prepare", "job-1")
  })

  it("relaunches prepare for a stale queued launch", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob("queued", { status: "pending" }),
    )
    vi.setSystemTime(new Date("2026-06-11T00:10:00.000Z"))

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      launched: true,
      kind: "prepare",
    })
    expect(launchShortsMock).toHaveBeenCalledWith("prepare", "job-1")
  })

  it("relaunches render for a stale render phase", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob("rendering", { status: "running" }),
    )
    vi.setSystemTime(new Date("2026-06-11T01:30:00.000Z"))

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      launched: true,
      kind: "render",
    })
    expect(launchShortsMock).toHaveBeenCalledWith("render", "job-1")
  })

  it("does not claim a workflow is running when rejecting a non-running phase", async () => {
    // force:"prepare" from a launch-failed job is still rejected (only plain
    // retries cover that state), but the copy must not pretend a workflow is
    // in flight.
    getJobMock.mockResolvedValue(buildShortsJob("queued", { status: "failed" }))

    const response = await POST(postRequest({ force: "prepare" }), routeParams)
    expect(response.status).toBe(409)
    const payload = (await response.json()) as { error: string; reason: string }
    expect(payload.reason).toBe("phase_invalid")
    expect(payload.error).not.toContain("while a workflow is running")
    expect(payload.error).toContain("from phase queued")
  })

  it.each<ShortsPhase>([
    "ready_for_review",
    "prepare_failed",
    "render_failed",
    "completed",
  ])(
    "force:prepare relaunches with force and confirms the caption-edit discard (phase %s)",
    async (phase) => {
      getJobMock.mockResolvedValue(buildShortsJob(phase))

      const response = await POST(
        postRequest({ force: "prepare" }),
        routeParams,
      )
      expect(response.status).toBe(202)
      await expect(response.json()).resolves.toEqual({
        launched: true,
        kind: "prepare",
        discardsCaptionEdits: true,
      })
      expect(launchShortsMock).toHaveBeenCalledWith("prepare", "job-1", {
        force: true,
      })
    },
  )

  it.each<ShortsPhase>(["queued", "preparing", "rendering", "mux_processing"])(
    "rejects force:prepare with 409 phase_invalid during phase %s",
    async (phase) => {
      getJobMock.mockResolvedValue(buildShortsJob(phase))

      const response = await POST(
        postRequest({ force: "prepare" }),
        routeParams,
      )
      expect(response.status).toBe(409)
      expect(launchShortsMock).not.toHaveBeenCalled()
    },
  )

  it("force:render relaunches render WITHOUT a force flag (propsHash reuse handles it)", async () => {
    getJobMock.mockResolvedValue(buildShortsJob("completed"))

    const response = await POST(postRequest({ force: "render" }), routeParams)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      launched: true,
      kind: "render",
    })
    expect(launchShortsMock).toHaveBeenCalledWith("render", "job-1")
  })

  it("resets the relaunched kind's step subset in place and appends an audit note", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob("prepare_failed", {
        steps: [
          {
            name: "shorts_prepare",
            status: "failed",
            retries: 0,
            error: "whisper failed",
          },
        ],
      }),
    )

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(202)

    const updates = updateJobMock.mock.calls[0]?.[1] as {
      steps: JobStepState[]
      errors: { step: string; message: string; at: string }[]
    }
    expect(updates.steps).toEqual([
      { name: "shorts_prepare", status: "pending", retries: 0 },
    ])
    // Error history is preserved; the operator audit note carries the actor
    // identity (smart-crop retry precedent).
    expect(updates.errors).toEqual([
      expect.objectContaining({
        step: "shorts_prepare",
        message: "Retry (prepare) requested by op@jesusfilm.org",
      }),
    ])
  })

  it("returns 503 config_missing when shorts-worker env is unset", async () => {
    envMutable.SHORTS_WORKER_BASE_URL = undefined

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      reason: "config_missing",
    })
    expect(launchShortsMock).not.toHaveBeenCalled()
  })

  it("rejects a concurrent duplicate retry with 409 already_in_flight", async () => {
    let releaseLaunch: () => void = () => {}
    launchShortsMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseLaunch = resolve
        }),
    )

    const first = POST(postRequest(), routeParams)
    await vi.waitFor(() => {
      expect(launchShortsMock).toHaveBeenCalledTimes(1)
    })

    const second = await POST(postRequest(), routeParams)
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toMatchObject({
      reason: "already_in_flight",
    })

    releaseLaunch()
    expect((await first).status).toBe(202)
    expect(launchShortsMock).toHaveBeenCalledTimes(1)
  })

  it("returns 500 and releases the slot when the launch throws", async () => {
    launchShortsMock.mockRejectedValueOnce(new Error("runtime down"))

    const first = await POST(postRequest(), routeParams)
    expect(first.status).toBe(500)
    await expect(first.json()).resolves.toMatchObject({
      reason: "launch_failed",
    })

    // Slot released in finally — the next retry proceeds.
    const second = await POST(postRequest(), routeParams)
    expect(second.status).toBe(202)
  })
})
