import { getCmsGateway, readMockCmsState } from "@/cms/gateway"
import { LiveJobsTable } from "@/features/jobs/live-jobs-table"
import { listJobs } from "@/lib/state"
import type { JobRecord } from "@/types/job"

export const dynamic = "force-dynamic"

function buildLanguageLabelsById(
  languages: Array<{ coreId: string; name: string }>,
): Record<string, string> {
  return Object.fromEntries(
    languages.map((language) => [language.coreId, language.name]),
  )
}

async function loadMockJobsPageData(
  gateway: ReturnType<typeof getCmsGateway>,
): Promise<{
  jobs: JobRecord[]
  languageLabelsById: Record<string, string>
}> {
  const mockState = await readMockCmsState(gateway)
  if (!mockState) {
    return { jobs: [], languageLabelsById: {} }
  }

  return {
    jobs: mockState.readModels.jobs,
    languageLabelsById: buildLanguageLabelsById(
      mockState.readModels.languageGeo.languages.map((language) => ({
        coreId: language.id,
        name: language.englishLabel,
      })),
    ),
  }
}

async function loadAdminJobsPageData(
  gateway: ReturnType<typeof getCmsGateway>,
): Promise<{
  jobs: JobRecord[]
  languageLabelsById: Record<string, string>
}> {
  const [jobs, languageGeo] = await Promise.all([
    listJobs({ limit: 50 }),
    gateway.getLanguageGeo(),
  ])
  return {
    jobs,
    languageLabelsById: buildLanguageLabelsById(
      languageGeo.languages.map((language) => ({
        coreId: language.id,
        name: language.englishLabel,
      })),
    ),
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function JobsPage() {
  const gateway = getCmsGateway()
  const { jobs, languageLabelsById } =
    gateway.mode === "mock"
      ? await loadMockJobsPageData(gateway)
      : await loadAdminJobsPageData(gateway)

  return (
    <div className="studio-page studio-page--jobs">
      <LiveJobsTable
        initialJobs={jobs}
        languageLabelsById={languageLabelsById}
      />
    </div>
  )
}
