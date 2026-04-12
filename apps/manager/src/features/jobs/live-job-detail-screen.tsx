"use client"

import React, { useEffect, useMemo, useState } from "react"
import { formatStepName } from "@/lib/workflow-steps"
import type { JobRecord } from "@/types/job"
import { LiveJobDetailHeader } from "./live-job-detail-header"
import { LiveJobStepsTable } from "./live-job-steps-table"
import { ReviewPlayerCard } from "./review-player/review-player-card"
import type { JobReviewContextResult } from "./review-player/review-player-types"

type ReviewContextLoadState =
  | {
      status: "loading"
    }
  | JobReviewContextResult

type LiveJobDetailScreenProps = {
  initialJob: JobRecord
  languageLabelsById: Record<string, string>
}

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

export function LiveJobDetailScreen({
  initialJob,
  languageLabelsById,
}: LiveJobDetailScreenProps) {
  const [job, setJob] = useState(initialJob)
  const [reviewContext, setReviewContext] = useState<ReviewContextLoadState>({
    status: "loading",
  })

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function loadReviewContext() {
      try {
        setReviewContext({ status: "loading" })
        const response = await fetch(
          `/api/jobs/${encodeURIComponent(initialJob.id)}/review-context`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        )

        if (!response.ok) {
          throw new Error(`Review context request failed (${response.status})`)
        }

        const payload = (await response.json()) as {
          reviewContext: JobReviewContextResult
        }

        if (!cancelled) {
          setReviewContext(payload.reviewContext)
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setReviewContext({
            status: "failed",
            message:
              error instanceof Error
                ? error.message
                : "Failed to load review context",
          })
        }
      }
    }

    void loadReviewContext()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [initialJob.id, job.updatedAt])

  const muxPlaybackId = useMemo(
    () => job.muxPlaybackId ?? null,
    [job.muxPlaybackId],
  )

  return (
    <>
      <LiveJobDetailHeader
        job={job}
        languageLabelsById={languageLabelsById}
        muxPlaybackId={muxPlaybackId}
      />

      <LiveJobStepsTable
        initialJob={initialJob}
        headingMeta={<code className="jobs-step-job-id">{initialJob.id}</code>}
        onJobUpdate={setJob}
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

      <ReviewPlayerCard job={job} reviewContext={reviewContext} />
    </>
  )
}
