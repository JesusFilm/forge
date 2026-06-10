import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord, JobStepState } from "@/types/job"

const {
  authenticateRequestMock,
  getJobMock,
  updateJobMock,
  launchSmartCropMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  getJobMock: vi.fn(),
  updateJobMock: vi.fn(),
  launchSmartCropMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  updateJob: updateJobMock,
}))

vi.mock("@/workflows/launchSmartCrop", () => ({
  launchSmartCrop: launchSmartCropMock,
}))

const { POST } = await import("@/app/api/smart-crop/jobs/[id]/retry/route")

function buildFailedJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const steps: JobStepState[] = [
    {
      name: "smart_crop_fingerprint",
      status: "completed",
      retries: 0,
      startedAt: "2026-06-09T00:00:00.000Z",
      finishedAt: "2026-06-09T00:01:00.000Z",
    },
    {
      name: "smart_crop_plan",
      status: "failed",
      retries: 0,
      startedAt: "2026-06-09T00:01:00.000Z",
      finishedAt: "2026-06-09T00:02:00.000Z",
      error: "mastra smart-crop plan failed (provider_failed)",
    },
    { name: "smart_crop_preview_render", status: "pending", retries: 0 },
    { name: "smart_crop_qa", status: "pending", retries: 0 },
  ]

  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pb-1",
    languages: [],
    options: {
      smartCrop: {
        kind: "canonical",
        assetId: "asset123",
        targetAspectRatio: "9:16",
        cropMode: "auto",
      },
    },
    status: "failed",
    retries: 0,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:02:00.000Z",
    artifacts: {},
    steps,
    errors: [
      {
        step: "smart_crop_plan",
        message: "mastra smart-crop plan failed (provider_failed)",
        at: "2026-06-09T00:02:00.000Z",
      },
    ],
    ...overrides,
  }
}

function postRequest(body?: unknown): Request {
  return new Request("http://example.test/api/smart-crop/jobs/job-1/retry", {
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

beforeEach(() => {
  authenticateRequestMock.mockReset()
  getJobMock.mockReset()
  updateJobMock.mockReset()
  launchSmartCropMock.mockReset()

  authenticateRequestMock.mockResolvedValue(null)
  getJobMock.mockResolvedValue(buildFailedJob())
  updateJobMock.mockResolvedValue(buildFailedJob({ status: "running" }))
  launchSmartCropMock.mockResolvedValue(undefined)
})

describe("POST /api/smart-crop/jobs/[id]/retry", () => {
  it("returns 404 for unknown jobs", async () => {
    getJobMock.mockResolvedValue(null)

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(404)
  })

  it("returns 409 for non-smart-crop jobs", async () => {
    getJobMock.mockResolvedValue(buildFailedJob({ options: {} }))

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(409)
  })

  it("returns 409 when the job is not failed", async () => {
    getJobMock.mockResolvedValue(buildFailedJob({ status: "running" }))

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(409)
  })

  it("resets failed steps, appends a retry note, and relaunches", async () => {
    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(202)

    const updates = updateJobMock.mock.calls[0]?.[1] as {
      status: string
      steps: JobStepState[]
      errors: Array<{ message: string }>
    }
    expect(updates.status).toBe("running")
    const planStep = updates.steps.find(
      (step) => step.name === "smart_crop_plan",
    )
    expect(planStep).toMatchObject({ status: "pending" })
    expect(planStep?.error).toBeUndefined()
    // Completed steps stay completed (idempotent artifact reuse).
    expect(
      updates.steps.find((step) => step.name === "smart_crop_fingerprint")
        ?.status,
    ).toBe("completed")
    // Error history kept + retry note appended.
    expect(updates.errors).toHaveLength(2)
    expect(updates.errors.at(-1)?.message).toBe("Retry requested by operator")

    expect(launchSmartCropMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "canonical",
        jobId: "job-1",
        assetId: "asset123",
        muxAssetId: "mux-1",
        playbackId: "pb-1",
        force: false,
      }),
    )
  })

  it("returns 500 and marks the job failed when the relaunch throws", async () => {
    launchSmartCropMock.mockRejectedValue(new Error("runtime down"))

    const response = await POST(postRequest(), routeParams)
    expect(response.status).toBe(500)
    expect(updateJobMock).toHaveBeenLastCalledWith("job-1", {
      status: "failed",
    })
  })

  it("threads force:true from the optional body to the relaunch", async () => {
    const response = await POST(postRequest({ force: true }), routeParams)
    expect(response.status).toBe(202)
    expect(launchSmartCropMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "canonical", force: true }),
    )
  })

  it("keeps force:false for an explicit empty body", async () => {
    const response = await POST(postRequest({}), routeParams)
    expect(response.status).toBe(202)
    expect(launchSmartCropMock).toHaveBeenCalledWith(
      expect.objectContaining({ force: false }),
    )
  })

  it("returns 400 for present-but-invalid bodies", async () => {
    const invalidJson = await POST(postRequest("{not json"), routeParams)
    expect(invalidJson.status).toBe(400)

    const invalidShape = await POST(postRequest({ force: "yes" }), routeParams)
    expect(invalidShape.status).toBe(400)
    expect(launchSmartCropMock).not.toHaveBeenCalled()
  })

  it("rejects a concurrent duplicate retry with 409 already_in_flight", async () => {
    let releaseLaunch: () => void = () => {}
    launchSmartCropMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseLaunch = resolve
        }),
    )

    const first = POST(postRequest(), routeParams)
    // Give the first request time to claim the in-flight slot.
    await vi.waitFor(() => {
      expect(launchSmartCropMock).toHaveBeenCalledTimes(1)
    })

    const second = await POST(postRequest(), routeParams)
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toMatchObject({
      reason: "already_in_flight",
    })

    releaseLaunch()
    const firstResponse = await first
    expect(firstResponse.status).toBe(202)
    expect(launchSmartCropMock).toHaveBeenCalledTimes(1)
  })
})
