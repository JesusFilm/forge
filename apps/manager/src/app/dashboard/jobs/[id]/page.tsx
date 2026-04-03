import React from "react"
import { notFound } from "next/navigation"
import { graphql } from "@forge/graphql"
import getClient from "@/cms/client"
import { formatStepName } from "@/lib/workflow-steps"
import { LiveJobDetailHeader } from "@/features/jobs/live-job-detail-header"
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

function formatDate(iso?: string): string {
  if (!iso) return "\u2013"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "\u2013"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

// ---------------------------------------------------------------------------
// Page
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

  const muxPlaybackId = job.muxPlaybackId ?? null

  return (
    <>
      <LiveJobDetailHeader
        initialJob={job}
        languageLabelsById={languageLabelsById}
        muxPlaybackId={muxPlaybackId}
      />

      <section
        className="collection-card jobs-card jobs-error-card"
        id="error-log"
      >
        <div className="jobs-card-header jobs-error-header">
          <h3 className="jobs-section-title">Error Log</h3>
          <span className="jobs-error-count">{job.errors.length}</span>
        </div>
        {job.errors.length === 0 ? (
          <p className="small">No errors recorded.</p>
        ) : (
          <div className="jobs-table-wrap">
            <table className="table jobs-table jobs-error-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Step</th>
                  <th>Code</th>
                </tr>
              </thead>
              <tbody>
                {job.errors.map((error, idx) => (
                  <React.Fragment key={`${error.at}-${idx}`}>
                    <tr className="jobs-error-primary-row">
                      <td>{formatDate(error.at)}</td>
                      <td>{formatStepName(error.step)}</td>
                      <td>
                        {error.code ? (
                          <code className="jobs-error-code">{error.code}</code>
                        ) : (
                          "\u2013"
                        )}
                      </td>
                    </tr>
                    <tr className="jobs-error-secondary-row">
                      <td colSpan={3}>
                        <p className="jobs-error-message">{error.message}</p>
                        <p className="jobs-error-hint">
                          {error.operatorHint ?? "\u2013"}
                        </p>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
