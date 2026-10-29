import { getCmsGateway, readMockCmsState } from "@/cms/gateway"
import { AgentsPage } from "@/features/agents/agents-page"
import type { LanguageOption } from "@/features/agents/automation-form"
import {
  getAdminAutomationAdapter,
  getAutomation,
  getAutomationRun,
  listAutomations,
} from "@/features/agents/automation-store"
import type {
  EnrichmentAutomation,
  EnrichmentAutomationRun,
} from "@/features/agents/automation-contract"

export const dynamic = "force-dynamic"

function buildLanguageOptions(
  languages: Array<{ coreId: string; name: string }>,
): LanguageOption[] {
  return languages.map((language) => ({
    coreId: language.coreId,
    name: language.name,
  }))
}

async function loadMockAgentsPageData(
  gateway: ReturnType<typeof getCmsGateway>,
): Promise<{
  automations: EnrichmentAutomation[]
  languageOptions: LanguageOption[]
}> {
  const mockState = await readMockCmsState(gateway)
  if (!mockState) {
    return { automations: [], languageOptions: [] }
  }

  return {
    automations: mockState.readModels.automations,
    languageOptions: buildLanguageOptions(
      mockState.readModels.languageGeo.languages.map((language) => ({
        coreId: language.id,
        name: language.englishLabel,
      })),
    ),
  }
}

async function loadLiveAgentsPageData(): Promise<{
  automations: EnrichmentAutomation[]
  languageOptions: LanguageOption[]
}> {
  let automations: EnrichmentAutomation[] = []
  let languageOptions: LanguageOption[] = []

  try {
    const adapter = await getAdminAutomationAdapter()
    const [automationResult, languageResult] = await Promise.all([
      listAutomations(),
      adapter.languages(),
    ])
    automations = automationResult
    languageOptions = buildLanguageOptions(languageResult)
  } catch (error) {
    console.error(
      "[agents/page] Failed to fetch automation data from Admin:",
      error,
    )
  }

  return { automations, languageOptions }
}

type ReportQuery = {
  automationId?: string | string[]
  runId?: string | string[]
}
type RequestedReport = { automationName: string; run: EnrichmentAutomationRun }
const unavailableReport = "The requested automation report is unavailable."

async function loadRequestedReport(query: ReportQuery | undefined): Promise<{
  requestedReport: RequestedReport | null
  reportError?: string
}> {
  if (!query?.automationId && !query?.runId) return { requestedReport: null }
  const { automationId, runId } = query
  if (
    typeof automationId !== "string" ||
    typeof runId !== "string" ||
    !automationId ||
    !runId ||
    automationId.length > 160 ||
    runId.length > 160
  ) {
    return { requestedReport: null, reportError: unavailableReport }
  }
  try {
    // A report URL is durable even after its run leaves the five-row list slice.
    const [automation, run] = await Promise.all([
      getAutomation(automationId),
      getAutomationRun(runId),
    ])
    if (
      automation &&
      run &&
      run.automationDocumentId === automation.documentId
    ) {
      return { requestedReport: { automationName: automation.name, run } }
    }
  } catch (error) {
    console.error("[agents/page] Failed to load requested report:", error)
  }
  return { requestedReport: null, reportError: unavailableReport }
}

export default async function AgentsDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<ReportQuery>
} = {}) {
  const gateway = getCmsGateway()
  const [{ automations, languageOptions }, report] = await Promise.all([
    gateway.mode === "mock"
      ? loadMockAgentsPageData(gateway)
      : loadLiveAgentsPageData(),
    searchParams
      ? searchParams.then(loadRequestedReport)
      : Promise.resolve({ requestedReport: null }),
  ])

  return (
    <div className="studio-page studio-page--agents">
      <AgentsPage
        initialAutomations={automations}
        languageOptions={languageOptions}
        {...report}
      />
    </div>
  )
}
