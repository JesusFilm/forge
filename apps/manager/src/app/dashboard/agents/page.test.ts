import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"
import type { EnrichmentAutomation } from "@/features/agents/automation-contract"

const {
  getAutomationMock,
  getRunMock,
  languagesMock,
  getCmsGatewayMock,
  liveAgentsPageMock,
  listAutomationsMock,
} = vi.hoisted(() => ({
  getAutomationMock: vi.fn(),
  getRunMock: vi.fn(),
  languagesMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
  liveAgentsPageMock: vi.fn(() => null),
  listAutomationsMock: vi.fn(),
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
  getAutomation: getAutomationMock,
  getAutomationRun: getRunMock,
  listAutomations: listAutomationsMock,
  getAdminAutomationAdapter: async () => ({ languages: languagesMock }),
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
  getAutomationMock.mockReset()
  getRunMock.mockReset()
  languagesMock.mockReset()
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

    expect(languagesMock).not.toHaveBeenCalled()
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
    languagesMock.mockResolvedValue([{ coreId: "529", name: "English" }])
    listAutomationsMock.mockResolvedValue([automation])

    const element = await AgentsDashboardPage()
    const page = element.props.children

    expect(listAutomationsMock).toHaveBeenCalledTimes(1)
    expect(languagesMock).toHaveBeenCalledTimes(1)
    expect(element.props.className).toBe("studio-page studio-page--agents")
    expect(page.props).toMatchObject({
      initialAutomations: [automation],
      languageOptions: [{ coreId: "529", name: "English" }],
    })
  })
  it("loads a linked old report independently of the five recent runs", async () => {
    const automation = makeAutomation({
      runs: Array.from({ length: 5 }, (_, index) => ({
        documentId: `recent-${index}`,
      })) as EnrichmentAutomation["runs"],
    })
    const oldRun = {
      documentId: "oldest-run",
      automationDocumentId: automation.documentId,
      status: "success",
      runMode: "dry_run",
      summary: "Sixth report selected",
    }
    getCmsGatewayMock.mockReturnValue({ mode: "live" })
    listAutomationsMock.mockResolvedValue([automation])
    languagesMock.mockResolvedValue([])
    getAutomationMock.mockResolvedValue(automation)
    getRunMock.mockResolvedValue(oldRun)
    const element = await AgentsDashboardPage({
      searchParams: Promise.resolve({
        automationId: automation.documentId,
        runId: oldRun.documentId,
      }),
    })
    expect(element.props.children.props.requestedReport).toEqual({
      automationName: automation.name,
      run: oldRun,
    })
    expect(getRunMock).toHaveBeenCalledWith("oldest-run")
    expect(getAutomationMock).toHaveBeenCalledWith(automation.documentId)
  })
  it("rejects a linked report belonging to another automation", async () => {
    const automation = makeAutomation()
    getCmsGatewayMock.mockReturnValue({ mode: "live" })
    listAutomationsMock.mockResolvedValue([automation])
    languagesMock.mockResolvedValue([])
    getAutomationMock.mockResolvedValue(automation)
    getRunMock.mockResolvedValue({
      documentId: "foreign-run",
      automationDocumentId: "another-automation",
    })
    const element = await AgentsDashboardPage({
      searchParams: Promise.resolve({
        automationId: automation.documentId,
        runId: "foreign-run",
      }),
    })
    expect(element.props.children.props.requestedReport).toBeNull()
    expect(element.props.children.props.reportError).toContain("unavailable")
  })
  it("rejects ambiguous query parameters without fetching a requested run", async () => {
    getCmsGatewayMock.mockReturnValue({ mode: "live" })
    listAutomationsMock.mockResolvedValue([])
    languagesMock.mockResolvedValue([])
    const element = await AgentsDashboardPage({
      searchParams: Promise.resolve({
        automationId: ["one", "two"],
        runId: "run",
      }),
    })
    expect(element.props.children.props.requestedReport).toBeNull()
    expect(element.props.children.props.reportError).toContain("unavailable")
    expect(getRunMock).not.toHaveBeenCalled()
    expect(getAutomationMock).not.toHaveBeenCalled()
  })

  it("keeps ordinary page loads free of report-specific reads", async () => {
    getCmsGatewayMock.mockReturnValue({ mode: "live" })
    listAutomationsMock.mockResolvedValue([])
    languagesMock.mockResolvedValue([])
    await AgentsDashboardPage({ searchParams: Promise.resolve({}) })
    expect(getRunMock).not.toHaveBeenCalled()
    expect(getAutomationMock).not.toHaveBeenCalled()
  })
})
