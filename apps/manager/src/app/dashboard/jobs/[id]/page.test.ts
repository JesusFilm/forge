import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"
import type { JobRecord } from "@/types/job"

const { getCmsGatewayMock, liveJobDetailScreenMock, notFoundMock, getJobMock } =
  vi.hoisted(() => ({
    getCmsGatewayMock: vi.fn(),
    liveJobDetailScreenMock: vi.fn(() => null),
    notFoundMock: vi.fn(() => {
      throw new Error("not-found")
    }),
    getJobMock: vi.fn(),
  }))

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

vi.mock("@/features/jobs/live-job-detail-screen", () => ({
  LiveJobDetailScreen: liveJobDetailScreenMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
}))

import JobDetailPage from "./page"

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
  liveJobDetailScreenMock.mockClear()
  notFoundMock.mockClear()
  getJobMock.mockReset()
})

describe("dashboard job detail page", () => {
  it("loads the requested job from mock state", async () => {
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

    const element = await JobDetailPage({
      params: Promise.resolve({ id: "job-1" }),
    })
    const detail = element.props.children

    expect(getJobMock).not.toHaveBeenCalled()
    expect(element.props.className).toBe("studio-page studio-page--job-detail")
    expect(detail.type).toBe(liveJobDetailScreenMock)
    expect(detail.props).toMatchObject({
      initialJob: job,
      languageLabelsById: { 529: "English" },
    })
  })

  it("loads the requested job from the admin gateway", async () => {
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
    getJobMock.mockResolvedValue(adminJob)

    const element = await JobDetailPage({
      params: Promise.resolve({ id: "job-admin" }),
    })
    const detail = element.props.children

    expect(getJobMock).toHaveBeenCalledWith("job-admin")
    expect(element.props.className).toBe("studio-page studio-page--job-detail")
    expect(detail.props).toMatchObject({
      initialJob: adminJob,
      languageLabelsById: { 529: "English" },
    })
  })
})
