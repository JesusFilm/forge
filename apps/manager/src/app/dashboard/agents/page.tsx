import { gql } from "@apollo/client"
import getClient from "@/cms/client"
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

export default async function AgentsDashboardPage() {
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
    languageOptions = (languageResult.data?.languages ?? [])
      .filter(
        (language): language is { coreId: string; name: string } =>
          language?.coreId != null && language.name != null,
      )
      .map((language) => ({
        coreId: language.coreId,
        name: language.name,
      }))
  } catch (error) {
    console.error("[agents/page] Failed to fetch data from Strapi:", error)
  }

  return (
    <div className="studio-page studio-page--agents">
      <AgentsPage
        initialAutomations={automations}
        languageOptions={languageOptions}
      />
    </div>
  )
}
