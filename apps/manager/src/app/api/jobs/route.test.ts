import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const {
  afterMock,
  authenticateRequestMock,
  buildInitialTranscriptionRoutingReportMock,
  countJobsMock,
  createJobMock,
  createMuxAssetMock,
  isAudioCleanupConfiguredMock,
  listJobSummariesMock,
  listJobsMock,
  runVideoEnrichmentMock,
  updateJobMock,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
  buildInitialTranscriptionRoutingReportMock: vi.fn(),
  countJobsMock: vi.fn(),
  createJobMock: vi.fn(),
  createMuxAssetMock: vi.fn(),
  isAudioCleanupConfiguredMock: vi.fn(),
  listJobSummariesMock: vi.fn(),
  listJobsMock: vi.fn(),
  runVideoEnrichmentMock: vi.fn(),
  updateJobMock: vi.fn(),
}))

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server")

  return {
    ...actual,
    after: afterMock,
  }
})

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/transcription-routing-report", () => ({
  buildInitialTranscriptionRoutingReport:
    buildInitialTranscriptionRoutingReportMock,
}))

vi.mock("@/lib/state", () => ({
  countJobs: countJobsMock,
  createJob: createJobMock,
  listJobSummaries: listJobSummariesMock,
  listJobs: listJobsMock,
  updateJob: updateJobMock,
}))

vi.mock("@/services/mux", () => ({
  createMuxAsset: createMuxAssetMock,
}))

vi.mock("@/services/audioCleanup", () => ({
  isAudioCleanupConfigured: isAudioCleanupConfiguredMock,
}))

vi.mock("@/workflows/videoEnrichment", () => ({
  runVideoEnrichment: runVideoEnrichmentMock,
}))

import { GET } from "@/app/api/jobs/route"

function buildJob(id: string): JobRecord {
  return {
    id,
    muxAssetId: `asset-${id}`,
    muxPlaybackId: `playback-${id}`,
    languages: ["fr"],
    options: {},
    status: "running",
    retries: 0,
    createdAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:01:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
  }
}

describe("GET /api/jobs", () => {
  beforeEach(() => {
    afterMock.mockReset()
    authenticateRequestMock.mockReset()
    buildInitialTranscriptionRoutingReportMock.mockReset()
    countJobsMock.mockReset()
    createJobMock.mockReset()
    createMuxAssetMock.mockReset()
    isAudioCleanupConfiguredMock.mockReset()
    listJobSummariesMock.mockReset()
    listJobsMock.mockReset()
    runVideoEnrichmentMock.mockReset()
    updateJobMock.mockReset()

    authenticateRequestMock.mockResolvedValue(null)
    listJobSummariesMock.mockResolvedValue([
      buildJob("job-1"),
      buildJob("job-2"),
    ])
    countJobsMock.mockResolvedValue(2)
  })

  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(new Request("http://example.test/api/jobs"))

    expect(response.status).toBe(401)
  })

  it("returns the summary envelope by default", async () => {
    const response = await GET(new Request("http://example.test/api/jobs"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      jobs: expect.arrayContaining([expect.objectContaining({ id: "job-1" })]),
      total: 2,
    })
    expect(listJobSummariesMock).toHaveBeenCalledTimes(1)
    expect(countJobsMock).not.toHaveBeenCalled()
  })

  it("returns the count envelope when requested", async () => {
    const response = await GET(
      new Request("http://example.test/api/jobs?view=count"),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ total: 2 })
    expect(countJobsMock).toHaveBeenCalledTimes(1)
    expect(listJobSummariesMock).not.toHaveBeenCalled()
  })
})
