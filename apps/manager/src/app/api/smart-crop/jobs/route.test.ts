import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const {
  authenticateRequestMock,
  createJobMock,
  listJobsMock,
  updateJobMock,
  getMuxAssetMock,
  artifactExistsMock,
  launchSmartCropMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  createJobMock: vi.fn(),
  listJobsMock: vi.fn(),
  updateJobMock: vi.fn(),
  getMuxAssetMock: vi.fn(),
  artifactExistsMock: vi.fn(),
  launchSmartCropMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  createJob: createJobMock,
  listJobs: listJobsMock,
  updateJob: updateJobMock,
}))

vi.mock("@/services/mux", () => ({
  getMuxAsset: getMuxAssetMock,
}))

vi.mock("@/services/storage", () => ({
  artifactExists: artifactExistsMock,
}))

vi.mock("@/workflows/launchSmartCrop", () => ({
  launchSmartCrop: launchSmartCropMock,
}))

vi.mock("@/config/env", () => ({
  env: {} as Record<string, string | undefined>,
}))

const { env } = await import("@/config/env")
const { GET, POST } = await import("@/app/api/smart-crop/jobs/route")

const envMutable = env as unknown as Record<string, string | undefined>

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pb-1",
    languages: [],
    options: {},
    status: "pending",
    retries: 0,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

function postRequest(body: unknown): Request {
  return new Request("http://example.test/api/smart-crop/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authenticateRequestMock.mockReset()
  createJobMock.mockReset()
  listJobsMock.mockReset()
  updateJobMock.mockReset()
  getMuxAssetMock.mockReset()
  artifactExistsMock.mockReset()
  launchSmartCropMock.mockReset()

  authenticateRequestMock.mockResolvedValue(null)
  createJobMock.mockResolvedValue(buildJob())
  listJobsMock.mockResolvedValue([])
  updateJobMock.mockResolvedValue(null)
  getMuxAssetMock.mockResolvedValue({
    assetId: "mux-1",
    playbackId: "pbresolved",
    status: "ready",
    duration: 60,
  })
  artifactExistsMock.mockResolvedValue(true)
  launchSmartCropMock.mockResolvedValue(undefined)

  envMutable.CROP_WORKER_BASE_URL = "https://crop-worker.internal"
  envMutable.CROP_WORKER_API_KEY = "crop-key"
  envMutable.MASTRA_BASE_URL = "https://mastra.internal"
  envMutable.MASTRA_SERVICE_API_KEY = "mastra-key"
})

describe("POST /api/smart-crop/jobs", () => {
  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await POST(
      postRequest({ kind: "canonical", muxAssetId: "mux-1" }),
    )
    expect(response.status).toBe(401)
  })

  it("returns 400 for invalid JSON bodies", async () => {
    const response = await POST(
      new Request("http://example.test/api/smart-crop/jobs", {
        method: "POST",
        body: "{not json",
      }),
    )
    expect(response.status).toBe(400)
  })

  it("requires language and canonicalAssetId for localized jobs", async () => {
    const response = await POST(
      postRequest({ kind: "localized", muxAssetId: "mux-1" }),
    )
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toBe("Validation failed")
  })

  it("returns 503 config_missing when smart-crop env is unset", async () => {
    envMutable.CROP_WORKER_BASE_URL = undefined

    const response = await POST(
      postRequest({ kind: "canonical", muxAssetId: "mux-1" }),
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      reason: "config_missing",
      retryable: false,
    })
  })

  it("returns 400 when the Mux asset has no playback id", async () => {
    getMuxAssetMock.mockRejectedValue(
      new Error("Mux asset mux-1 has no playback ID"),
    )

    const response = await POST(
      postRequest({ kind: "canonical", muxAssetId: "mux-1" }),
    )
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain("playback")
  })

  it("returns 400 for an operator-supplied playbackId with an invalid shape", async () => {
    const response = await POST(
      postRequest({
        kind: "canonical",
        muxAssetId: "mux-1",
        playbackId: "pb-1; rm -rf /",
      }),
    )
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toBe("Validation failed")
    expect(launchSmartCropMock).not.toHaveBeenCalled()
  })

  it("returns 400 when the Mux-resolved playbackId has an invalid shape", async () => {
    getMuxAssetMock.mockResolvedValue({
      assetId: "mux-1",
      playbackId: "pb/../evil",
      status: "ready",
      duration: 60,
    })

    const response = await POST(
      postRequest({ kind: "canonical", muxAssetId: "mux-1" }),
    )
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain("not a valid Mux playback ID")
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("returns 400 when a localized job would overwrite the canonical artifacts", async () => {
    const response = await POST(
      postRequest({
        kind: "localized",
        muxAssetId: "mux-uk",
        assetId: "asset123",
        canonicalAssetId: "asset123",
        language: "uk",
        playbackId: "pbuk",
      }),
    )
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toBe("Validation failed")
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("returns 400 canonical_plan_missing for localized jobs without a plan", async () => {
    artifactExistsMock.mockResolvedValue(false)

    const response = await POST(
      postRequest({
        kind: "localized",
        muxAssetId: "mux-uk",
        canonicalAssetId: "asset123",
        language: "uk",
      }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      reason: "canonical_plan_missing",
    })
    expect(artifactExistsMock).toHaveBeenCalledWith(
      "asset123",
      "smart-crop-plan-9x16-v1",
      "json",
    )
  })

  it("creates a canonical job, persists options.smartCrop, and launches", async () => {
    const response = await POST(
      postRequest({
        kind: "canonical",
        muxAssetId: "mux-1",
        cropMode: "speaker",
      }),
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      job: { id: "job-1" },
    })

    expect(createJobMock).toHaveBeenCalledWith(
      "mux-1",
      "pbresolved",
      [],
      expect.objectContaining({
        jobOptions: {
          smartCrop: {
            kind: "canonical",
            assetId: "mux-1",
            targetAspectRatio: "9:16",
            cropMode: "speaker",
          },
        },
        steps: [
          expect.objectContaining({ name: "smart_crop_fingerprint" }),
          expect.objectContaining({ name: "smart_crop_plan" }),
          expect.objectContaining({ name: "smart_crop_preview_render" }),
          expect.objectContaining({ name: "smart_crop_qa" }),
        ],
      }),
    )
    expect(launchSmartCropMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "canonical",
        jobId: "job-1",
        assetId: "mux-1",
        muxAssetId: "mux-1",
        playbackId: "pbresolved",
        cropMode: "speaker",
      }),
    )
  })

  it("creates localized jobs with the localized step inventory and language", async () => {
    const response = await POST(
      postRequest({
        kind: "localized",
        muxAssetId: "mux-uk",
        assetId: "asset456",
        canonicalAssetId: "asset123",
        language: "uk",
        playbackId: "pbuk",
      }),
    )

    expect(response.status).toBe(201)
    expect(getMuxAssetMock).not.toHaveBeenCalled()
    expect(createJobMock).toHaveBeenCalledWith(
      "mux-uk",
      "pbuk",
      ["uk"],
      expect.objectContaining({
        jobOptions: {
          smartCrop: expect.objectContaining({
            kind: "localized",
            assetId: "asset456",
            canonicalAssetId: "asset123",
            language: "uk",
          }),
        },
        steps: expect.arrayContaining([
          expect.objectContaining({ name: "smart_crop_align" }),
          expect.objectContaining({ name: "smart_crop_render" }),
          expect.objectContaining({ name: "smart_crop_mux_output" }),
        ]),
      }),
    )
    expect(launchSmartCropMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "localized",
        canonicalAssetId: "asset123",
        language: "uk",
      }),
    )
  })

  it("marks the job failed and returns 500 when the launch throws", async () => {
    launchSmartCropMock.mockRejectedValue(new Error("workflow runtime down"))

    const response = await POST(
      postRequest({ kind: "canonical", muxAssetId: "mux-1" }),
    )
    expect(response.status).toBe(500)
    expect(updateJobMock).toHaveBeenCalledWith("job-1", { status: "failed" })
  })
})

describe("GET /api/smart-crop/jobs", () => {
  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(
      new Request("http://example.test/api/smart-crop/jobs"),
    )
    expect(response.status).toBe(401)
  })

  it("filters to jobs with options.smartCrop", async () => {
    listJobsMock.mockResolvedValue([
      buildJob({ id: "enrichment-job" }),
      buildJob({
        id: "smart-crop-job",
        options: {
          smartCrop: {
            kind: "canonical",
            assetId: "asset123",
            targetAspectRatio: "9:16",
            cropMode: "auto",
          },
        },
      }),
    ])

    const response = await GET(
      new Request("http://example.test/api/smart-crop/jobs"),
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { jobs: JobRecord[] }
    expect(payload.jobs.map((job) => job.id)).toEqual(["smart-crop-job"])
  })
})
