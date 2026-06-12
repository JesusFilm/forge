import { beforeEach, describe, expect, it, vi } from "vitest"
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
const { POST } = await import("@/app/api/shorts/jobs/[id]/render/route")

const envMutable = env as unknown as Record<string, string | undefined>

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

function buildShortsJob(
  phase: ShortsPhase = "ready_for_review",
  overrides: Partial<JobRecord> = {},
): JobRecord {
  const steps: JobStepState[] = [
    {
      name: "shorts_prepare",
      status: "completed",
      retries: 0,
      startedAt: "2026-06-11T00:00:00.000Z",
      finishedAt: "2026-06-11T00:05:00.000Z",
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
    status: "completed",
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

function postRequest(): Request {
  return new Request("http://example.test/api/shorts/jobs/job-1/render", {
    method: "POST",
  })
}

const routeParams = { params: Promise.resolve({ id: "job-1" }) }

beforeEach(() => {
  authenticateManagerOverrideRequestMock.mockReset()
  getJobMock.mockReset()
  updateJobMock.mockReset()
  launchShortsMock.mockReset()
  clearShortsLaunchSlots()

  authenticateManagerOverrideRequestMock.mockResolvedValue(sessionActor)
  getJobMock.mockResolvedValue(buildShortsJob())
  updateJobMock.mockResolvedValue(buildShortsJob())
  launchShortsMock.mockResolvedValue(undefined)

  envMutable.SHORTS_WORKER_BASE_URL = "https://shorts-worker.internal"
  envMutable.SHORTS_WORKER_API_KEY = "shorts-key"
})

describe("POST /api/shorts/jobs/[id]/render", () => {
  it("rejects unauthorized callers", async () => {
    const { NextResponse } = await import("next/server")
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      NextResponse.json({ error: "auth required" }, { status: 403 }),
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
      buildShortsJob("ready_for_review", { options: {} }),
    )

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      reason: "not_shorts_job",
    })
  })

  it.each<ShortsPhase>([
    "queued",
    "preparing",
    "rendering",
    "mux_processing",
    "prepare_failed",
  ])("returns 409 phase_invalid for phase %s", async (phase) => {
    getJobMock.mockResolvedValue(buildShortsJob(phase))

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      reason: "phase_invalid",
      phase,
    })
    expect(launchShortsMock).not.toHaveBeenCalled()
  })

  it.each<ShortsPhase>(["ready_for_review", "render_failed", "completed"])(
    "launches the render workflow from phase %s",
    async (phase) => {
      getJobMock.mockResolvedValue(buildShortsJob(phase))

      const response = await POST(postRequest(), routeParams)
      expect(response.status).toBe(202)
      await expect(response.json()).resolves.toEqual({ launched: true })
      expect(launchShortsMock).toHaveBeenCalledWith("render", "job-1")
    },
  )

  it("returns 503 config_missing when shorts-worker env is unset", async () => {
    envMutable.SHORTS_WORKER_API_KEY = undefined

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      reason: "config_missing",
      retryable: false,
    })
    expect(launchShortsMock).not.toHaveBeenCalled()
  })

  it("resets the render-step subset in place, preserving prepare steps", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob("completed", {
        steps: [
          {
            name: "shorts_prepare",
            status: "completed",
            retries: 0,
          },
          {
            name: "shorts_render",
            status: "completed",
            retries: 0,
            finishedAt: "2026-06-11T00:10:00.000Z",
          },
          {
            name: "shorts_mux_output",
            status: "failed",
            retries: 0,
            error: "mux_output_errored",
          },
        ],
      }),
    )

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(202)

    const updates = updateJobMock.mock.calls[0]?.[1] as {
      steps: JobStepState[]
    }
    expect(updates.steps.map((step) => [step.name, step.status])).toEqual([
      ["shorts_prepare", "completed"],
      ["shorts_render", "pending"],
      ["shorts_mux_output", "pending"],
    ])
    // No duplicate render rows on re-render.
    expect(
      updates.steps.filter((step) => step.name === "shorts_render"),
    ).toHaveLength(1)
  })

  it("rejects a concurrent duplicate launch with 409 already_in_flight", async () => {
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
    const firstResponse = await first
    expect(firstResponse.status).toBe(202)
    expect(launchShortsMock).toHaveBeenCalledTimes(1)
  })

  it("returns 500 with a typed envelope when the launch throws", async () => {
    launchShortsMock.mockRejectedValue(new Error("workflow runtime down"))

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      reason: "launch_failed",
      retryable: true,
    })
  })

  it("releases the slot even when the post-claim body throws synchronously", async () => {
    // updateJob is the first call after the sync claim — make it throw
    // synchronously to prove the try/finally covers the entire body.
    updateJobMock.mockImplementationOnce(() => {
      throw new Error("sync boom")
    })

    const first = await POST(postRequest(), routeParams)
    expect(first.status).toBe(500)

    // The slot must have been released — a follow-up launch proceeds
    // instead of getting 409 already_in_flight.
    updateJobMock.mockResolvedValue(buildShortsJob())
    const second = await POST(postRequest(), routeParams)
    expect(second.status).toBe(202)
    expect(launchShortsMock).toHaveBeenCalledTimes(1)
  })
})
