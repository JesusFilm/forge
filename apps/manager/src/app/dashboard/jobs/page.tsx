import { graphql } from "@forge/graphql"
import getClient from "@/cms/client"
import { getCmsGateway, type CmsGateway } from "@/cms/gateway"
import { LiveJobsTable } from "@/features/jobs/live-jobs-table"
import { listJobSummaries, toJobRecord } from "@/lib/state"
import type { JobRecord } from "@/types/job"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// GraphQL operations
// ---------------------------------------------------------------------------

const LIST_ENRICHMENT_JOBS = graphql(`
  query ListEnrichmentJobsPage($sort: [String], $pagination: PaginationArg) {
    enrichmentJobs(sort: $sort, pagination: $pagination) {
      documentId
      muxAssetId
      muxPlaybackId
      languages
      status
      currentStep
      retries
      startedAt
      completedAt
      artifacts
      errors
      video {
        title
        parents(pagination: { limit: -1 }) {
          title
        }
      }
      steps {
        name
        status
        retries
        startedAt
        finishedAt
        error
        details
      }
      createdAt
      updatedAt
    }
  }
`)

const GET_LANGUAGE_LABELS = graphql(`
  query GetLanguageLabels($pagination: PaginationArg) {
    languages(pagination: $pagination) {
      coreId
      name
    }
  }
`)

function buildLanguageLabelsById(
  languages: Array<{ id: string; name: string }>,
) {
  return Object.fromEntries(
    languages.map((language) => [language.id, language.name]),
  )
}

async function loadBackendJobsPageData(gateway: CmsGateway): Promise<{
  jobs: JobRecord[]
  languageLabelsById: Record<string, string>
}> {
  const [jobs, languageGeo] = await Promise.all([
    listJobSummaries(),
    gateway.getLanguageGeo(),
  ])

  return {
    jobs,
    languageLabelsById: buildLanguageLabelsById(
      languageGeo.languages.map((language) => ({
        id: language.id,
        name: language.englishLabel,
      })),
    ),
  }
}

async function loadLiveJobsPageData(): Promise<{
  jobs: JobRecord[]
  languageLabelsById: Record<string, string>
}> {
  let jobs: JobRecord[] = []
  let languageLabelsById: Record<string, string> = {}

  try {
    const client = getClient()

    const [jobsResult, languagesResult] = await Promise.all([
      client.query({
        query: LIST_ENRICHMENT_JOBS,
        variables: {
          sort: ["createdAt:desc"],
          pagination: { pageSize: 50 },
        },
        fetchPolicy: "no-cache",
      }),
      client.query({
        query: GET_LANGUAGE_LABELS,
        variables: {
          pagination: { pageSize: 100 },
        },
        fetchPolicy: "no-cache",
      }),
    ])

    const jobNodes = jobsResult.data?.enrichmentJobs ?? []
    jobs = jobNodes
      .filter((node): node is NonNullable<typeof node> => node != null)
      .map((node) => toJobRecord(node as Parameters<typeof toJobRecord>[0]))

    const languages = languagesResult.data?.languages ?? []
    languageLabelsById = buildLanguageLabelsById(
      languages
        .filter(
          (lang): lang is { coreId: string; name: string } =>
            lang != null && lang.coreId != null && lang.name != null,
        )
        .map((language) => ({ id: language.coreId, name: language.name })),
    )
  } catch (error) {
    console.error("[jobs/page] Failed to fetch data from Strapi:", error)
  }

  return { jobs, languageLabelsById }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function JobsPage() {
  const gateway = getCmsGateway()
  const { jobs, languageLabelsById } =
    gateway.mode !== "strapi"
      ? await loadBackendJobsPageData(gateway)
      : await loadLiveJobsPageData()

  return (
    <div className="studio-page studio-page--jobs">
      <LiveJobsTable
        initialJobs={jobs}
        languageLabelsById={languageLabelsById}
      />
    </div>
  )
}
