// TODO: Replace untyped `gql` enrichment job query with typed @forge/graphql
// operation once codegen runs for the EnrichmentJob content type.

import { gql } from "@apollo/client"
import { graphql } from "@forge/graphql"
import getClient from "@/cms/client"
import { LiveJobsTable } from "@/features/jobs/live-jobs-table"
import { toJobRecord } from "@/lib/state"
import type { JobRecord } from "@/types/job"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// GraphQL operations
// ---------------------------------------------------------------------------

// Untyped — EnrichmentJob not in introspection schema yet
const LIST_ENRICHMENT_JOBS = gql`
  query ListEnrichmentJobs($sort: [String], $pagination: PaginationArg) {
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
      steps {
        name
        status
        retries
        startedAt
        finishedAt
        error
      }
      createdAt
      updatedAt
    }
  }
`

// Typed — Language is in the introspection schema
const GET_LANGUAGE_LABELS = graphql(`
  query GetLanguageLabels($pagination: PaginationArg) {
    languages(pagination: $pagination) {
      gatewayId
      name
    }
  }
`)

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function JobsPage() {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jobsData = jobsResult.data as any
    jobs = (jobsData?.enrichmentJobs ?? []).map(toJobRecord)

    const languages = languagesResult.data?.languages ?? []
    languageLabelsById = Object.fromEntries(
      languages
        .filter(
          (lang): lang is { gatewayId: string; name: string } =>
            lang != null && lang.gatewayId != null && lang.name != null,
        )
        .map((lang) => [lang.gatewayId, lang.name]),
    )
  } catch (error) {
    console.error("[jobs/page] Failed to fetch data from Strapi:", error)
  }

  return (
    <LiveJobsTable initialJobs={jobs} languageLabelsById={languageLabelsById} />
  )
}
