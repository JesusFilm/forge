import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"
import type { JobRecord } from "@/types/job"

const { getCmsGatewayMock, liveJobsTableMock, listJobsMock } = vi.hoisted(
  () => ({
    getCmsGatewayMock: vi.fn(),
    liveJobsTableMock: vi.fn(() => null),
    listJobsMock: vi.fn(),
  }),
)

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
  listJobs: listJobsMock,
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
  getCmsGatewayMock.mockReset()
  liveJobsTableMock.mockClear()
  listJobsMock.mockReset()
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

    expect(listJobsMock).not.toHaveBeenCalled()
    expect(element.props.className).toBe("studio-page studio-page--jobs")
    expect(table.type).toBe(liveJobsTableMock)
    expect(table.props).toMatchObject({
      initialJobs: [job],
      languageLabelsById: { 529: "English" },
    })
  })

  it("loads initial data from the admin gateway", async () => {
    const adminJob = makeJobRecord({ id: "job-admin" })

    getCmsGatewayMock.mockReturnValue({
      mode: "admin",
      getLanguageGeo: vi.fn(async () => ({
        continents: [],
        countries: [],
        languages: [
          {
            id: "529",
            englishLabel: "English",
            nativeLabel: "English",
            countryIds: [],
            continentIds: [],
            countrySpeakers: {},
          },
        ],
      })),
    })
    listJobsMock.mockResolvedValue([adminJob])

    const element = await JobsPage()
    const table = element.props.children

    expect(listJobsMock).toHaveBeenCalledWith({ limit: 50 })
    expect(element.props.className).toBe("studio-page studio-page--jobs")
    expect(table.props).toMatchObject({
      initialJobs: [adminJob],
      languageLabelsById: { 529: "English" },
    })
  })

  it("passes Shorts jobs from the admin gateway to the jobs table", async () => {
    const shortsJob = makeJobRecord({
      id: "job-shorts",
      languages: [],
      options: {
        shorts: {
          assetId: "asset-1-short-1234abcd",
          sourceMuxAssetId: "asset-1",
          sourcePlaybackId: "playback-1",
          clip: { startSec: 10, endSec: 40 },
          language: { bcp47: "en", whisper: "en" },
        },
      },
      currentStep: "shorts_prepare",
      steps: [{ name: "shorts_prepare", status: "running", retries: 0 }],
    })

    getCmsGatewayMock.mockReturnValue({
      mode: "admin",
      getLanguageGeo: vi.fn(async () => ({
        continents: [],
        countries: [],
        languages: [],
      })),
    })
    listJobsMock.mockResolvedValue([shortsJob])

    const element = await JobsPage()
    const table = element.props.children

    expect(table.props).toMatchObject({
      initialJobs: [shortsJob],
      languageLabelsById: {},
    })
  })
})
