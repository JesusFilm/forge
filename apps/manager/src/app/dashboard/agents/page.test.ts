import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"
import type { EnrichmentAutomation } from "@/features/agents/automation-contract"

const {
  getClientMock,
  getCmsGatewayMock,
  liveAgentsPageMock,
  listAutomationsMock,
} = vi.hoisted(() => ({
  getClientMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
  liveAgentsPageMock: vi.fn(() => null),
  listAutomationsMock: vi.fn(),
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

vi.mock("@/features/agents/agents-page", () => ({
  AgentsPage: liveAgentsPageMock,
}))

vi.mock("@/features/agents/automation-store", () => ({
  listAutomations: listAutomationsMock,
}))

import AgentsDashboardPage from "./page"

function makeAutomation(
  overrides: Partial<EnrichmentAutomation> = {},
): EnrichmentAutomation {
  return {
    documentId: "automation-1",
    name: "Metadata refresh",
    template: "metadata_missing",
    status: "active",
    runMode: "live",
    schedule: { kind: "every_minute", timezone: "UTC" },
    scheduleSummary: "Every minute",
    timezone: "UTC",
    refreshMode: "missing_only",
    targetLanguageIds: ["529"],
    maxVideosPerRun: 5,
    runs: [],
    ...overrides,
  }
}

beforeEach(() => {
  getClientMock.mockReset()
  getCmsGatewayMock.mockReset()
  liveAgentsPageMock.mockClear()
  listAutomationsMock.mockReset()
})

describe("dashboard agents page", () => {
  it("loads initial automations from mock state", async () => {
    const automation = makeAutomation()
    const mockState = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    mockState.readModels.automations = [automation]
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

    const element = await AgentsDashboardPage()
    const page = element.props.children

    expect(getClientMock).not.toHaveBeenCalled()
    expect(listAutomationsMock).not.toHaveBeenCalled()
    expect(element.props.className).toBe("studio-page studio-page--agents")
    expect(page.type).toBe(liveAgentsPageMock)
    expect(page.props).toMatchObject({
      initialAutomations: [automation],
      languageOptions: [{ coreId: "529", name: "English" }],
    })
  })

  it("keeps the live automation loader intact", async () => {
    const automation = makeAutomation({ documentId: "automation-live" })

    getCmsGatewayMock.mockReturnValue({ mode: "live" })
    getClientMock.mockReturnValue({
      query: vi.fn().mockResolvedValueOnce({
        data: {
          languages: [{ coreId: "529", name: "English" }],
        },
      }),
    })
    listAutomationsMock.mockResolvedValue([automation])

    const element = await AgentsDashboardPage()
    const page = element.props.children

    expect(listAutomationsMock).toHaveBeenCalledTimes(1)
    expect(getClientMock).toHaveBeenCalledTimes(1)
    expect(element.props.className).toBe("studio-page studio-page--agents")
    expect(page.props).toMatchObject({
      initialAutomations: [automation],
      languageOptions: [{ coreId: "529", name: "English" }],
    })
  })
})
