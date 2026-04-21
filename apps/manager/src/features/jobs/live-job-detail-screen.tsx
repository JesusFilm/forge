"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  PageDescription,
  PageEyebrow,
  PageIntro,
  PageTitle,
} from "@/components/ui/page-intro"
import type { JobRecord } from "@/types/job"
import { JobErrorLogSection } from "./job-error-log-section"
import { LiveJobDetailHeader } from "./live-job-detail-header"
import { getSourceTitle } from "./jobs-table-presenter"
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
      <PageIntro className="mb-8">
        <PageEyebrow>Workflow run</PageEyebrow>
        <PageTitle className="text-[clamp(3rem,8vw,4.75rem)]">
          {getSourceTitle(job)}
        </PageTitle>
        <PageDescription className="max-w-4xl">
          Review job status, workflow steps, generated outputs, and sync details
          for this enrichment run.
        </PageDescription>
      </PageIntro>

      <LiveJobDetailHeader
        job={job}
        languageLabelsById={languageLabelsById}
        muxPlaybackId={muxPlaybackId}
      />

      <LiveJobStepsTable
        initialJob={initialJob}
        headingMeta={
          <code className="inline-flex items-center rounded-full border border-border/70 bg-secondary/25 px-3 py-1 text-[12px] font-medium tracking-[0.12em] text-muted-foreground">
            {initialJob.id}
          </code>
        }
        onJobUpdate={setJob}
      />

      <JobErrorLogSection errors={job.errors} />

      <ReviewPlayerCard job={job} reviewContext={reviewContext} />
    </>
  )
}
