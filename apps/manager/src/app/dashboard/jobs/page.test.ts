import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"
import type { JobRecord } from "@/types/job"

const { getClientMock, getCmsGatewayMock, liveJobsTableMock, toJobRecordMock } =
  vi.hoisted(() => ({
    getClientMock: vi.fn(),
    getCmsGatewayMock: vi.fn(),
    liveJobsTableMock: vi.fn(() => null),
    toJobRecordMock: vi.fn(),
  }))

vi.mock("@/cms/client", () => ({
  default: getClientMock,
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

vi.mock("@/features/jobs/live-jobs-table", () => ({
  LiveJobsTable: liveJobsTableMock,
}))

vi.mock("@/lib/state", () => ({
  toJobRecord: toJobRecordMock,
}))

import JobsPage from "./page"

function makeJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: ["529"],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-22T12:00:00.000Z",
    updatedAt: "2026-04-22T12:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

beforeEach(() => {
  getClientMock.mockReset()
  getCmsGatewayMock.mockReset()
  liveJobsTableMock.mockClear()
  toJobRecordMock.mockReset()
})

describe("dashboard jobs page", () => {
  it("loads initial data from the mock gateway state", async () => {
    const job = makeJobRecord()
    const mockState = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    mockState.readModels.jobs = [job]
    mockState.readModels.languageGeo.languages = [
      {
        id: "529",
        englishLabel: "English",
        nativeLabel: "English",
        countryIds: ["us"],
        continentIds: ["na"],
        countrySpeakers: { us: 331000000 },
      },
    ]

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => mockState),
    })

    const element = await JobsPage()
    const table = element.props.children

    expect(getClientMock).not.toHaveBeenCalled()
    expect(element.props.className).toBe("studio-page studio-page--jobs")
    expect(table.type).toBe(liveJobsTableMock)
    expect(table.props).toMatchObject({
      initialJobs: [job],
      languageLabelsById: { 529: "English" },
    })
  })

  it("keeps the live GraphQL loader intact", async () => {
    const liveJob = makeJobRecord({ id: "job-live" })

    getCmsGatewayMock.mockReturnValue({ mode: "live" })
    getClientMock.mockReturnValue({
      query: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            enrichmentJobs: [{ documentId: "job-live", raw: true }],
          },
        })
        .mockResolvedValueOnce({
          data: {
            languages: [{ coreId: "529", name: "English" }],
          },
        }),
    })
    toJobRecordMock.mockReturnValue(liveJob)

    const element = await JobsPage()
    const table = element.props.children

    expect(getClientMock).toHaveBeenCalledTimes(1)
    expect(toJobRecordMock).toHaveBeenCalledWith({
      documentId: "job-live",
      raw: true,
    })
    expect(element.props.className).toBe("studio-page studio-page--jobs")
    expect(table.props).toMatchObject({
      initialJobs: [liveJob],
      languageLabelsById: { 529: "English" },
    })
  })
})
