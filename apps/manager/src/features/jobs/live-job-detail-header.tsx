"use client"

import React, { useCallback, useMemo, useState } from "react"
import {
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  TriangleAlert,
} from "lucide-react"
import {
  getJobMuxEnvironment,
  getMuxEnvironmentLabel,
  getMuxEnvironmentTooltip,
} from "@/lib/mux-environment"
import {
  getTranscriptionRoutingReport,
  hasUnresolvedElevenLabsFailure,
} from "@/lib/transcription-routing-report"
import type { JobRecord } from "@/types/job"
import {
  getDisplayedJobStatus,
  getLanguageBadges,
} from "@/features/jobs/jobs-table-presenter"
import { formatDuration } from "@/features/jobs/live-job-steps-table"

type LiveJobDetailHeaderProps = {
  job: JobRecord
  languageLabelsById: Record<string, string>
  muxPlaybackId?: string | null
}

function formatDate(iso?: string): string {
  if (!iso) {
    return "–"
  }
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return "–"
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

function formatCreatedSummary(input: {
  createdAt?: string
  status: "pending" | "running" | "completed" | "failed"
  completedAt?: string
  updatedAt?: string
}): string {
  const created = formatDate(input.createdAt)
  const finishedAt = input.completedAt ?? input.updatedAt
  const duration = formatDuration(input.createdAt, finishedAt)
  if (duration === "–") {
    return created
  }

  if (input.status === "completed") {
    return `${created} (ran ${duration})`
  }

  if (input.status === "failed") {
    return `${created} (failed in ${duration})`
  }

  return `${created} (in progress ${duration})`
}

export function LiveJobDetailHeader({
  job,
  languageLabelsById,
  muxPlaybackId,
}: LiveJobDetailHeaderProps) {
  const [muxIdCopied, setMuxIdCopied] = useState(false)

  const languageBadges = useMemo(
    () =>
      getLanguageBadges(
        job,
        new Map<string, string>(Object.entries(languageLabelsById)),
      ),
    [job, languageLabelsById],
  )

  const handleCopyMuxId = useCallback(async () => {
    if (
      !job.muxAssetId ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return
    }

    try {
      await navigator.clipboard.writeText(job.muxAssetId)
      setMuxIdCopied(true)
      window.setTimeout(() => {
        setMuxIdCopied(false)
      }, 1600)
    } catch {
      setMuxIdCopied(false)
    }
  }, [job.muxAssetId])

  const muxWatchUrl = useMemo(() => {
    if (!muxPlaybackId) {
      return null
    }
    return `https://player.mux.com/${encodeURIComponent(muxPlaybackId)}`
  }, [muxPlaybackId])
  const muxEnvironment = useMemo(
    () => getJobMuxEnvironment(job.artifacts),
    [job.artifacts],
  )
  const transcriptionRoutingReport = useMemo(
    () => getTranscriptionRoutingReport(job.artifacts),
    [job.artifacts],
  )
  const displayJobStatus = useMemo(() => getDisplayedJobStatus(job), [job])
  const muxEnvironmentTooltip = useMemo(
    () => getMuxEnvironmentTooltip(muxEnvironment),
    [muxEnvironment],
  )
  const muxEnvironmentLabel = useMemo(
    () => getMuxEnvironmentLabel(muxEnvironment),
    [muxEnvironment],
  )
  const MuxEnvironmentIcon =
    muxEnvironment === "staging" ? FlaskConical : TriangleAlert

  return (
    <section className="collection-card jobs-card jobs-summary-card">
      <div className="grid cols-2 jobs-detail-grid">
        <div>
          <div className="small">Status</div>
          <div className="jobs-summary-status-row">
            <span
              className={`badge ${displayJobStatus} jobs-summary-status-badge`}
            >
              {displayJobStatus}
            </span>
            <span
              className="jobs-summary-retries-pill"
              title={`Retries: ${job.retries}`}
            >
              {job.retries} retries
            </span>
            {job.status === "completed" &&
            hasUnresolvedElevenLabsFailure(transcriptionRoutingReport) ? (
              <span className="jobs-error-log-link">
                ElevenLabs required output missing
              </span>
            ) : null}
            {job.errors.length > 0 ? (
              <a href="#error-log" className="jobs-error-log-link">
                Error log
              </a>
            ) : null}
          </div>
        </div>
        <div>
          <div className="small">Created</div>
          <div>
            {formatCreatedSummary({
              createdAt: job.createdAt,
              status: displayJobStatus,
              completedAt: job.completedAt,
              updatedAt: job.updatedAt,
            })}
          </div>
        </div>
        <div>
          <div className="small">Languages</div>
          {languageBadges.length > 0 ? (
            <div
              className="jobs-language-badges"
              title={languageBadges.map((badge) => badge.text).join(", ")}
            >
              {languageBadges.map((badge) => (
                <span
                  key={`${job.id}-${badge.key}`}
                  className="jobs-language-badge"
                >
                  {badge.text}
                </span>
              ))}
            </div>
          ) : (
            <span className="jobs-no-issue">none</span>
          )}
        </div>
        <div>
          <div className="small">Mux ID</div>
          <div className="jobs-mux-row">
            <code className="jobs-mux-id" title={job.muxAssetId}>
              {job.muxAssetId}
            </code>
            <div className="jobs-mux-actions">
              <button
                type="button"
                className="jobs-inline-icon-button"
                onClick={handleCopyMuxId}
                aria-label="Copy Mux ID"
                title={muxIdCopied ? "Copied" : "Copy Mux ID"}
              >
                {muxIdCopied ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <Copy size={15} aria-hidden="true" />
                )}
              </button>
              {muxWatchUrl ? (
                <>
                  <a
                    href={muxWatchUrl}
                    className="jobs-mux-watch-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>Watch on Mux</span>
                  </a>
                  <span
                    className={`jobs-mux-environment-indicator jobs-mux-environment-indicator--${muxEnvironment}`}
                    title={muxEnvironmentTooltip}
                    aria-label={muxEnvironmentTooltip}
                    tabIndex={0}
                  >
                    <MuxEnvironmentIcon size={14} aria-hidden="true" />
                    <span className="jobs-mux-environment-indicator__label">
                      {muxEnvironmentLabel}
                    </span>
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
