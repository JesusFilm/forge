import React from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getJob } from "@/lib/state"
import { LiveJobDetailHeader } from "@/features/jobs/live-job-detail-header"

export const dynamic = "force-dynamic"

function formatDate(iso?: string): string {
  if (!iso) {
    return "\u2013"
  }

  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return "\u2013"
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

function formatStepName(step: string): string {
  return step
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const job = await getJob(id)

  if (!job) {
    notFound()
  }

  return (
    <main className="jobs-main">
      <div className="report-shell jobs-report-shell">
        <header className="report-header jobs-header">
          <div className="header-content">
            <div className="header-selectors">
              <span className="control-label control-label--title">
                Enrichment Queue
              </span>
              <div className="header-selectors-row">
                <div className="report-control report-control--text">
                  <span className="control-value control-value--static">
                    Job Details
                  </span>
                </div>
                <Link
                  href="/dashboard/jobs"
                  className="header-nav-link jobs-back-link"
                >
                  <span className="header-nav-link-icon" aria-hidden="true">
                    <svg
                      viewBox="0 0 16 16"
                      role="presentation"
                      focusable="false"
                    >
                      <path d="M8 3L3 8l5 5M4 8h9" />
                    </svg>
                  </span>
                  <span>Back to jobs</span>
                </Link>
              </div>
            </div>
          </div>
          <div className="header-diagram">
            <div className="header-diagram-menu header-nav-tabs">
              <Link href="/dashboard/coverage" className="header-nav-link">
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

        <LiveJobDetailHeader initialJob={job} />

        <section
          className="collection-card jobs-card jobs-error-card"
          id="error-log"
        >
          <div className="jobs-card-header jobs-error-header">
            <h3 className="jobs-section-title">Error Log</h3>
            <span className="jobs-error-count">{job.errors?.length ?? 0}</span>
          </div>
          {!job.errors || job.errors.length === 0 ? (
            <p className="small">No errors recorded.</p>
          ) : (
            <div className="jobs-table-wrap">
              <table className="table jobs-table jobs-error-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Step</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {job.errors.map((error, idx) => (
                    <tr
                      key={`${error.at}-${idx}`}
                      className="jobs-error-primary-row"
                    >
                      <td>{formatDate(error.at)}</td>
                      <td>{formatStepName(error.step)}</td>
                      <td>
                        <span className="jobs-error-message">
                          {error.message}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
