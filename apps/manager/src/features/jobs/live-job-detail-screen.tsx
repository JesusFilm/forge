"use client"

import React, { useEffect, useMemo, useState } from "react"
import type { JobRecord } from "@/types/job"
import { JobErrorLogSection } from "./job-error-log-section"
import { LiveJobDetailHeader } from "./live-job-detail-header"
import { getSourceTitle } from "./jobs-table-presenter"
import { LiveJobStepsTable } from "./live-job-steps-table"
import { ReviewPlayerCard } from "./review-player/review-player-card"
import { getReviewContextRefreshKey } from "./review-player/review-context-refresh-key"
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

export function LiveJobDetailScreen({
  initialJob,
  languageLabelsById,
}: LiveJobDetailScreenProps) {
  const [job, setJob] = useState(initialJob)
  const [reviewContext, setReviewContext] = useState<ReviewContextLoadState>({
    status: "loading",
  })
  const reviewContextRefreshKey = useMemo(
    () => getReviewContextRefreshKey(job),
    [job],
  )

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
  }, [initialJob.id, reviewContextRefreshKey])

  const muxPlaybackId = useMemo(
    () => job.muxPlaybackId ?? null,
    [job.muxPlaybackId],
  )

  return (
    <>
      <header className="studio-page-intro">
        <span className="studio-page-eyebrow">Workflow run</span>
        <h1>{getSourceTitle(job)}</h1>
        <p>
          Review job status, workflow steps, generated outputs, and sync details
          for this enrichment run.
        </p>
      </header>

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

      <JobErrorLogSection errors={job.errors} />

      <ReviewPlayerCard job={job} reviewContext={reviewContext} />
    </>
  )
}
