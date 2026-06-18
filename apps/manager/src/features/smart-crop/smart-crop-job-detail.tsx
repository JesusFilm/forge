"use client"

// Smart Crop job detail: steps table, summary card (phase / plan / alignment /
// QA / output / usage), operator actions (approve, reject, retry), artifact
// download links, and the preview video when rendered.
// Plan 2026-06-09-002 "UI".

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Check, RefreshCw, X } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
import { getArtifactsForStep } from "@/lib/job-artifacts"
import { formatStepName } from "@/lib/workflow-steps"
import type { JobRecord } from "@/types/job"
import {
  canRetrySmartCropJob,
  canReviewSmartCropPlan,
  getSmartCropJobSummary,
  listSmartCropArtifactLinks,
} from "./smart-crop-presenter"
import {
  SmartCropPlanReviewPlayer,
  type SmartCropAttemptSelection,
} from "./smart-crop-plan-review-player"

const SMART_CROP_POLL_INTERVAL_MS = 5_000

type SmartCropJobDetailProps = {
  initialJob: JobRecord
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "–"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso))
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function SmartCropJobDetail({ initialJob }: SmartCropJobDetailProps) {
  const [job, setJob] = useState<JobRecord>(initialJob)
  const [pendingAction, setPendingAction] = useState<
    "approve" | "reject" | "retry" | null
  >(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [attemptSelection, setAttemptSelection] =
    useState<SmartCropAttemptSelection | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch(
        `/api/jobs/${encodeURIComponent(initialJob.id)}`,
        { cache: "no-store" },
      )
      if (!response.ok) return
      const payload = (await response.json()) as { job?: JobRecord }
      if (payload.job) {
        setJob(payload.job)
      }
    } catch {
      // transient polling failure — keep the previous snapshot
    }
  }, [initialJob.id])

  useEffect(() => {
    const id = window.setInterval(
      () => void refresh(),
      SMART_CROP_POLL_INTERVAL_MS,
    )
    return () => window.clearInterval(id)
  }, [refresh])

  const summary = getSmartCropJobSummary(job)

  const handleReview = useCallback(
    async (action: "approve" | "reject") => {
      setPendingAction(action)
      setActionError(null)
      try {
        const response = await apiFetch(
          `/api/smart-crop/jobs/${encodeURIComponent(job.id)}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              ...(attemptSelection
                ? {
                    attemptIndex: attemptSelection.attemptIndex,
                    manifestDigest: attemptSelection.manifestDigest,
                  }
                : {}),
            }),
          },
        )
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          setActionError(payload.error ?? `Failed to ${action} plan`)
        }
        await refresh()
      } catch {
        setActionError(`Failed to ${action} plan`)
      } finally {
        setPendingAction(null)
      }
    },
    [attemptSelection, job.id, refresh],
  )

  const handleRetry = useCallback(async () => {
    setPendingAction("retry")
    setActionError(null)
    try {
      const response = await apiFetch(
        `/api/smart-crop/jobs/${encodeURIComponent(job.id)}/retry`,
        { method: "POST" },
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        setActionError(payload.error ?? "Failed to retry job")
      }
      await refresh()
    } catch {
      setActionError("Failed to retry job")
    } finally {
      setPendingAction(null)
    }
  }, [job.id, refresh])

  if (!summary) {
    return (
      <section className="collection-card jobs-card">
        <p className="small jobs-empty-state">
          This job has no smart-crop options.{" "}
          <Link href={`/dashboard/jobs/${job.id}`}>Open in Jobs</Link>
        </p>
      </section>
    )
  }

  const report = summary.report
  const artifactLinks = listSmartCropArtifactLinks(job)
  const showReviewButtons = canReviewSmartCropPlan(job)
  const reviewRequiresAttemptSelection =
    job.artifacts["smart-crop-attempts"]?.kind === "downloadable"
  const reviewActionDisabled =
    pendingAction !== null ||
    (reviewRequiresAttemptSelection && attemptSelection === null)
  const showRetryButton = canRetrySmartCropJob(job)
  const latestError = job.errors.at(-1)
  // Live render progress mirrored into the running step's details by the
  // workflow (throttled crop-worker onProgress).
  const runningStepDetails = job.steps.find(
    (step) => step.status === "running" && step.details?.progress != null,
  )?.details

  return (
    <>
      <header className="studio-page-intro studio-page-intro--with-actions">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Smart Crop</span>
          <h1>
            {summary.kind === "canonical" ? "Canonical" : "Localized"} job{" "}
            {job.id}
          </h1>
          <p>
            Asset {summary.assetId}
            {summary.language ? ` · ${summary.language}` : ""}
            {summary.canonicalAssetId
              ? ` · canonical ${summary.canonicalAssetId}`
              : ""}
          </p>
        </div>
        <div className="studio-page-intro-actions">
          {showReviewButtons ? (
            <>
              <button
                type="button"
                className="jobs-primary-button"
                disabled={reviewActionDisabled}
                onClick={() => void handleReview("approve")}
              >
                {pendingAction === "approve" ? (
                  <RefreshCw className="icon is-spinning" aria-hidden="true" />
                ) : (
                  <Check className="icon" aria-hidden="true" />
                )}
                Approve plan
              </button>
              <button
                type="button"
                className="jobs-primary-button"
                disabled={reviewActionDisabled}
                onClick={() => void handleReview("reject")}
              >
                {pendingAction === "reject" ? (
                  <RefreshCw className="icon is-spinning" aria-hidden="true" />
                ) : (
                  <X className="icon" aria-hidden="true" />
                )}
                Reject plan
              </button>
            </>
          ) : null}
          {showRetryButton ? (
            <button
              type="button"
              className="jobs-primary-button"
              disabled={pendingAction !== null}
              onClick={() => void handleRetry()}
            >
              <RefreshCw
                className={`icon${pendingAction === "retry" ? " is-spinning" : ""}`}
                aria-hidden="true"
              />
              Retry job
            </button>
          ) : null}
        </div>
      </header>

      {actionError ? <p className="jobs-error-text">{actionError}</p> : null}

      <section className="collection-card jobs-card">
        <div className="jobs-card-header">
          <h3 className="jobs-section-title">Smart Crop summary</h3>
          <span
            className={`jobs-progress-summary jobs-progress-summary-${job.status}`}
          >
            {job.status} · {summary.phaseLabel}
          </span>
        </div>
        <dl className="grid cols-2">
          <div>
            <dt className="small jobs-field-label">Plan</dt>
            <dd>
              {report?.plan
                ? `${report.plan.segmentCount} segments · ${report.plan.approved ? "approved" : "not approved"}`
                : "–"}
            </dd>
          </div>
          <div>
            <dt className="small jobs-field-label">Alignment</dt>
            <dd>
              {report?.alignment
                ? `confidence ${formatPercent(report.alignment.overallConfidence)} · unmapped ${report.alignment.unmappedDurationPercent.toFixed(1)}% · gate ${report.alignment.gatePassed ? "passed" : "failed"}`
                : "–"}
            </dd>
          </div>
          <div>
            <dt className="small jobs-field-label">QA verdict</dt>
            <dd>
              {report?.qa?.verdict ??
                (report?.qa?.unavailableReason
                  ? `unavailable (${report.qa.unavailableReason})`
                  : "–")}
            </dd>
          </div>
          <div>
            <dt className="small jobs-field-label">Render progress</dt>
            <dd>
              {runningStepDetails?.progress != null
                ? `${Math.round(runningStepDetails.progress * 100)}%${
                    runningStepDetails.message
                      ? ` · ${runningStepDetails.message}`
                      : ""
                  }`
                : "–"}
            </dd>
          </div>
          <div>
            <dt className="small jobs-field-label">Output</dt>
            <dd>
              {report?.output
                ? `${report.output.muxAssetId}${report.output.playbackId ? ` · ${report.output.playbackId}` : ""}`
                : "–"}
            </dd>
          </div>
          <div>
            <dt className="small jobs-field-label">Token usage</dt>
            <dd>
              {report?.usage
                ? `${report.usage.inputTokens} in / ${report.usage.outputTokens} out`
                : "–"}
            </dd>
          </div>
          <div>
            <dt className="small jobs-field-label">Last error</dt>
            <dd>{latestError ? latestError.message : "–"}</dd>
          </div>
        </dl>
      </section>

      <SmartCropPlanReviewPlayer
        job={job}
        onSelectedAttemptChange={setAttemptSelection}
      />

      <section className="collection-card jobs-card">
        <div className="jobs-card-header">
          <h3 className="jobs-section-title">Steps</h3>
        </div>
        <div className="jobs-table-wrap">
          <table className="table jobs-table jobs-detail-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Artifacts</th>
              </tr>
            </thead>
            <tbody>
              {job.steps.map((step) => {
                const stepArtifacts = getArtifactsForStep(
                  step.name,
                  job.id,
                  job.artifacts,
                )
                return (
                  <React.Fragment key={step.name}>
                    <tr>
                      <td>{formatStepName(step.name)}</td>
                      <td>
                        <span
                          className={`jobs-step-dot jobs-step-dot-${step.status}`}
                        >
                          {step.status}
                        </span>
                      </td>
                      <td>{formatTimestamp(step.startedAt)}</td>
                      <td>{formatTimestamp(step.finishedAt)}</td>
                      <td>
                        {stepArtifacts.length === 0
                          ? "–"
                          : stepArtifacts.map((artifact, index) => (
                              <React.Fragment key={artifact.key}>
                                {index > 0 ? ", " : null}
                                <a href={artifact.url}>{artifact.label}</a>
                              </React.Fragment>
                            ))}
                      </td>
                    </tr>
                    {step.error ? (
                      <tr className="jobs-issue-row">
                        <td aria-hidden="true" />
                        <td colSpan={4}>
                          <p className="jobs-error-text" title={step.error}>
                            {step.error}
                          </p>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {artifactLinks.length > 0 ? (
        <section className="collection-card jobs-card">
          <div className="jobs-card-header">
            <h3 className="jobs-section-title">Artifacts</h3>
          </div>
          <ul className="jobs-step-detail-list">
            {artifactLinks.map((artifact) => (
              <li key={artifact.key} className="jobs-step-detail-item">
                <a href={artifact.href}>{artifact.label}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
