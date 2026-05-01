import { gql } from "@apollo/client"
import getClient from "@/cms/client"
import { getCmsGateway, readMockCmsState } from "@/cms/gateway"
import { AgentsPage } from "@/features/agents/agents-page"
import type { LanguageOption } from "@/features/agents/automation-form"
import { listAutomations } from "@/features/agents/automation-store"
import type { EnrichmentAutomation } from "@/features/agents/automation-contract"

export const dynamic = "force-dynamic"

const GET_AGENT_LANGUAGE_OPTIONS = gql`
  query GetAgentLanguageOptions {
    languages(sort: ["name:asc"], pagination: { pageSize: 100 }) {
      coreId
      name
    }
  }
`

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
    const client = getClient()
    const [automationResult, languageResult] = await Promise.all([
      listAutomations(),
      client.query<{
        languages?: Array<{
          coreId?: string | null
          name?: string | null
        } | null>
      }>({
        query: GET_AGENT_LANGUAGE_OPTIONS,
        fetchPolicy: "no-cache",
      }),
    ])

    automations = automationResult
    languageOptions = buildLanguageOptions(
      (languageResult.data?.languages ?? []).filter(
        (language): language is { coreId: string; name: string } =>
          language?.coreId != null && language.name != null,
      ),
    )
  } catch (error) {
    console.error("[agents/page] Failed to fetch data from Strapi:", error)
  }

  return { automations, languageOptions }
}

export default async function AgentsDashboardPage() {
  const gateway = getCmsGateway()
  const { automations, languageOptions } =
    gateway.mode === "mock"
      ? await loadMockAgentsPageData(gateway)
      : await loadLiveAgentsPageData()

  return (
    <div className="studio-page studio-page--agents">
      <AgentsPage
        initialAutomations={automations}
        languageOptions={languageOptions}
      />
    </div>
  )
}
