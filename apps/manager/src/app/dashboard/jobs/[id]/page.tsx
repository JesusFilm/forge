import React from "react"
import { notFound } from "next/navigation"
import { graphql } from "@forge/graphql"
import getClient from "@/cms/client"
import { LiveJobDetailScreen } from "@/features/jobs/live-job-detail-screen"
import { toJobRecord } from "@/lib/state"
import type { JobRecord } from "@/types/job"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// GraphQL operations
// ---------------------------------------------------------------------------

const GET_ENRICHMENT_JOB = graphql(`
  query GetEnrichmentJobDetail($documentId: ID!) {
    enrichmentJob(documentId: $documentId) {
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
        documentId
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
  query GetLanguageLabelsForJobDetail($pagination: PaginationArg) {
    languages(pagination: $pagination) {
      coreId
      name
    }
  }
`)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let job: JobRecord | null = null
  let languageLabelsById: Record<string, string> = {}

  try {
    const client = getClient()

    const [jobResult, languagesResult] = await Promise.all([
      client.query({
        query: GET_ENRICHMENT_JOB,
        variables: { documentId: id },
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

    const jobData = jobResult.data
    if (jobData?.enrichmentJob) {
      job = toJobRecord(
        jobData.enrichmentJob as Parameters<typeof toJobRecord>[0],
      )
    }

    const languages = languagesResult.data?.languages ?? []
    languageLabelsById = Object.fromEntries(
      languages
        .filter(
          (lang): lang is { coreId: string; name: string } =>
            lang != null && lang.coreId != null && lang.name != null,
        )
        .map((lang) => [lang.coreId, lang.name]),
    )
  } catch (error) {
    console.error("[jobs/[id]/page] Failed to fetch data from Strapi:", error)
    // Graceful degradation — job stays null, triggers notFound below
  }

  if (!job) {
    notFound()
  }

  return (
    <div className="studio-page studio-page--job-detail">
      <LiveJobDetailScreen
        initialJob={job}
        languageLabelsById={languageLabelsById}
      />
    </div>
  )
}
