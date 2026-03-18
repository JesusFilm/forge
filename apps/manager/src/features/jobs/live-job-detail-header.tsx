"use client"

import React, { useCallback, useMemo, useState } from "react"
import { Check, Copy, ExternalLink } from "lucide-react"
import type { JobRecord } from "@/types/job"
import { LiveJobStepsTable } from "./live-job-steps-table"

type LiveJobDetailHeaderProps = {
  initialJob: JobRecord
}

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

function formatDuration(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) {
    return "\u2013"
  }

  const startMs = Date.parse(startIso)
  const endMs = Date.parse(endIso)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return "\u2013"
  }

  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
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
  if (duration === "\u2013") {
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

export function LiveJobDetailHeader({ initialJob }: LiveJobDetailHeaderProps) {
  const [job, setJob] = useState(initialJob)
  const [muxIdCopied, setMuxIdCopied] = useState(false)

  const handleJobUpdate = useCallback((nextJob: JobRecord) => {
    setJob(nextJob)
  }, [])

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
    if (!job.muxPlaybackId) {
      return null
    }
    return `https://player.mux.com/${encodeURIComponent(job.muxPlaybackId)}`
  }, [job.muxPlaybackId])

  return (
    <>
      <section className="collection-card jobs-card jobs-summary-card">
        <div className="grid cols-2 jobs-detail-grid">
          <div>
            <div className="small">Status</div>
            <div className="jobs-summary-status-row">
              <span className={`badge ${job.status} jobs-summary-status-badge`}>
                {job.status}
              </span>
              <span
                className="jobs-summary-retries-pill"
                title={`Retries: ${job.retries}`}
              >
                {job.retries} retries
              </span>
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
                status: job.status,
                completedAt: job.completedAt,
                updatedAt: job.updatedAt,
              })}
            </div>
          </div>
          <div>
            <div className="small">Languages</div>
            {job.languages.length > 0 ? (
              <div className="jobs-language-badges">
                {job.languages.map((lang) => (
                  <span key={lang} className="jobs-language-badge">
                    {lang}
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
                  <a
                    href={muxWatchUrl}
                    className="jobs-mux-watch-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>Watch on Mux</span>
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <LiveJobStepsTable
        initialJob={initialJob}
        headingMeta={<code className="jobs-step-job-id">{initialJob.id}</code>}
        onJobUpdate={handleJobUpdate}
      />
    </>
  )
}
