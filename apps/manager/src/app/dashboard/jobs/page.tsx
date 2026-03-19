import React from "react"
import Link from "next/link"
import type { Route } from "next"
import { listJobs } from "@/lib/state"
import { LiveJobsTable } from "@/features/jobs/live-jobs-table"

export const dynamic = "force-dynamic"

type SearchParamValue = string | string[] | undefined

type SearchParamsInput = Record<string, SearchParamValue>

type PageProps = {
  searchParams?: Promise<SearchParamsInput>
}

function getSingleSearchParam(value: SearchParamValue): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value[0] ?? null
  return null
}

function parseRequestedLanguageIds(raw: SearchParamValue): string[] {
  const scalar = getSingleSearchParam(raw)
  if (!scalar) return []
  return [
    ...new Set(
      scalar
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
}

export default async function JobsPage({ searchParams }: PageProps) {
  const normalizedSearchParams = searchParams ? await searchParams : {}
  const requestedLanguageIds = parseRequestedLanguageIds(
    normalizedSearchParams.languageIds ?? normalizedSearchParams.languageId,
  )
  const coverageReportQuery =
    requestedLanguageIds.length > 0
      ? `?languageId=${encodeURIComponent(requestedLanguageIds.join(","))}`
      : ""
  const jobs = await listJobs()
  const languageLabelsById: Record<string, string> = {}

  return (
    <main className="jobs-main">
      <div className="report-shell jobs-report-shell">
        <header className="report-header jobs-header">
          <div className="header-brand">
            <Link
              href={`/dashboard/coverage${coverageReportQuery}` as Route}
              aria-label="Go to coverage report"
            >
              <img
                src="/jesusfilm-sign.svg"
                alt="Jesus Film Project"
                className="header-logo"
              />
            </Link>
          </div>
          <div className="header-content">
            <div className="header-selectors">
              <span className="control-label control-label--title">
                Enrichment Queue
              </span>
              <div className="header-selectors-row">
                <div className="report-control report-control--text">
                  <span className="control-value control-value--static">
                    Jobs
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="header-diagram">
            <div className="header-diagram-menu header-nav-tabs">
              <Link
                href={`/dashboard/coverage${coverageReportQuery}` as Route}
                className="header-nav-link"
              >
                <span className="header-nav-link-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 16 16"
                    role="presentation"
                    focusable="false"
                  >
                    <path d="M1.5 8c1.8-3 4-4.5 6.5-4.5S12.7 5 14.5 8c-1.8 3-4 4.5-6.5 4.5S3.3 11 1.5 8z" />
                    <circle cx="8" cy="8" r="2.1" />
                  </svg>
                </span>
                <span>Report</span>
              </Link>
              <Link
                href="/dashboard/jobs"
                className="header-nav-link is-active"
                aria-current="page"
              >
                <span className="header-nav-link-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 16 16"
                    role="presentation"
                    focusable="false"
                  >
                    <path d="M3 4h6M3 8h10M3 12h8" />
                  </svg>
                </span>
                <span>Queue</span>
              </Link>
            </div>
          </div>
        </header>

        <LiveJobsTable
          initialJobs={jobs}
          languageLabelsById={languageLabelsById}
        />
      </div>
    </main>
  )
}
