"use client"

import React, { useState } from "react"
import { Network, RefreshCw } from "lucide-react"
import { getEmbeddingSyncReport } from "@/lib/embedding-sync-report"
import type { EmbeddingSyncReport, JobRecord } from "@/types/job"

type EmbeddingSyncCardProps = {
  job: JobRecord
  onJobUpdate?: (job: JobRecord) => void
}

type EmbeddingSyncDetailsProps = {
  report: EmbeddingSyncReport
  job: JobRecord
  onJobUpdate?: (job: JobRecord) => void
  variant?: "card" | "inline"
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

function shortenFingerprint(fingerprint?: string): string {
  if (!fingerprint) {
    return "–"
  }

  return fingerprint.length > 24
    ? `${fingerprint.slice(0, 12)}...${fingerprint.slice(-8)}`
    : fingerprint
}

export function canOverrideEmbeddingSync(
  report: EmbeddingSyncReport | undefined,
): boolean {
  return Boolean(
    report?.status === "skipped_existing" &&
    report?.videoDocumentId &&
    report.generated.contentFingerprint &&
    report.cms?.contentFingerprint,
  )
}

export function shouldExpandEmbeddingSyncByDefault(
  report: EmbeddingSyncReport | undefined,
): boolean {
  return report?.status === "failed"
}

export function getEmbeddingSyncExplanation(
  report: EmbeddingSyncReport,
): string {
  switch (report.status) {
    case "applied_missing":
      return "CMS had no transcript embeddings, so the generated transcript chunks were indexed automatically."
    case "skipped_existing":
      return "CMS already had transcript embeddings for this video, so automatic overwrite was skipped."
    case "override_applied":
      return "An operator explicitly reindexed CMS from this job’s generated transcript embeddings."
    case "unsupported":
      if (report.reason === "no_video_document_id") {
        return "This workflow run has no CMS video document ID, so transcript embeddings could not be synced."
      }
      if (report.reason === "chunk_limit_exceeded") {
        return "The generated transcript exceeded the current CMS request limit, so sync was skipped."
      }
      return "This job produced transcript embeddings, but this run is outside the supported CMS sync path."
    case "failed":
      if (report.reason === "video_not_found") {
        return "The target CMS video could not be found when sync ran."
      }
      if (report.reason === "unpublished_video") {
        return "Only published CMS videos are indexed in v1, so draft-only content was not synced."
      }
      if (report.reason === "cms_missing") {
        return "The last compare refresh found no current CMS transcript embeddings for this video."
      }
      if (report.reason === "artifact_missing") {
        return "The embeddings artifact could not be read back from storage for sync."
      }
      return "Transcript embeddings generation succeeded, but the CMS sync subphase did not."
  }
}

function SummaryRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="jobs-embedding-sync-row">
      <span className="jobs-embedding-sync-label">{label}</span>
      <span
        className={
          mono
            ? "jobs-embedding-sync-value jobs-embedding-sync-value-mono"
            : "jobs-embedding-sync-value"
        }
      >
        {value}
      </span>
    </div>
  )
}

function EmbeddingSyncDetails({
  report,
  job,
  onJobUpdate,
  variant = "card",
}: EmbeddingSyncDetailsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionMessage, setActionMessage] = useState<{
    tone: "neutral" | "success" | "warning" | "error"
    text: string
  } | null>(null)

  const canOverride = canOverrideEmbeddingSync(report)
  const rootClassName =
    variant === "inline"
      ? "jobs-embedding-sync-inline"
      : "collection-card jobs-card jobs-embedding-sync-card"
  const showExplanation = variant === "card" || report.status === "failed"

  async function handleOverride() {
    setIsSubmitting(true)
    setActionMessage(null)

    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(job.id)}/embedding-sync/override`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expectedGeneratedContentFingerprint:
              report.generated.contentFingerprint,
            expectedExistingContentFingerprint: report.cms?.contentFingerprint,
          }),
        },
      )

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        job?: JobRecord
      }

      if (payload.job) {
        onJobUpdate?.(payload.job)
      }

      if (response.ok) {
        setActionMessage({
          tone: "success",
          text: "CMS transcript embeddings were reindexed from this job.",
        })
        return
      }

      if (response.status === 409) {
        setActionMessage({
          tone: "warning",
          text: "CMS changed since this compare was reviewed. The summary was refreshed; review it again before overriding.",
        })
        return
      }

      setActionMessage({
        tone: "error",
        text: payload.error ?? "Failed to override CMS transcript embeddings.",
      })
    } catch {
      setActionMessage({
        tone: "error",
        text: "Failed to override CMS transcript embeddings.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className={rootClassName}>
      {variant === "inline" ? (
        <div className="jobs-embedding-sync-inline-header">
          <h4 className="jobs-embedding-sync-inline-title">
            Transcript Embeddings CMS Sync
          </h4>
          {showExplanation ? (
            <p className="jobs-embedding-sync-inline-summary">
              {getEmbeddingSyncExplanation(report)}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="jobs-card-header">
          <div className="jobs-step-header-group">
            <Network size={18} aria-hidden="true" />
            <div>
              <h3 className="jobs-section-title">
                Transcript Embeddings CMS Sync
              </h3>
              <p className="jobs-embedding-sync-summary">
                {getEmbeddingSyncExplanation(report)}
              </p>
            </div>
          </div>
          <span className={`badge jobs-embedding-sync-badge ${report.status}`}>
            {report.status}
          </span>
        </div>
      )}

      <div className="jobs-embedding-sync-grid">
        <div className="jobs-embedding-sync-panel">
          <h4 className="jobs-embedding-sync-heading">
            Generated Transcript Artifact
          </h4>
          <SummaryRow label="Model" value={report.generated.model} />
          <SummaryRow
            label="Chunk count"
            value={String(report.generated.chunkCount)}
          />
          <SummaryRow
            label="Generated"
            value={formatDate(report.generated.generatedAt)}
          />
          <SummaryRow
            label="Fingerprint"
            value={shortenFingerprint(report.generated.contentFingerprint)}
            mono
          />
        </div>

        <div className="jobs-embedding-sync-panel">
          <h4 className="jobs-embedding-sync-heading">
            CMS Transcript Vector Index
          </h4>
          <SummaryRow
            label="Resolved video ID"
            value={report.cms ? String(report.cms.resolvedVideoId) : "–"}
          />
          <SummaryRow
            label="Rows present"
            value={report.cms?.hasEmbeddings ? "Yes" : "No"}
          />
          <SummaryRow
            label="Chunk count"
            value={report.cms ? String(report.cms.chunkCount) : "0"}
          />
          <SummaryRow label="Model" value={report.cms?.model ?? "–"} />
          <SummaryRow
            label="Fingerprint"
            value={shortenFingerprint(report.cms?.contentFingerprint)}
            mono
          />
        </div>
      </div>

      {actionMessage ? (
        <p
          className={`jobs-embedding-sync-message jobs-embedding-sync-message-${actionMessage.tone}`}
        >
          {actionMessage.text}
        </p>
      ) : null}

      {canOverride ? (
        <div className="jobs-embedding-sync-actions">
          <button
            type="button"
            className="jobs-primary-button"
            onClick={handleOverride}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <RefreshCw
                  size={14}
                  aria-hidden="true"
                  className="jobs-spin-icon"
                />
                <span>Reindexing...</span>
              </>
            ) : (
              "Override CMS Transcript Embeddings"
            )}
          </button>
        </div>
      ) : null}
    </section>
  )
}

export function EmbeddingSyncCard({
  job,
  onJobUpdate,
}: EmbeddingSyncCardProps) {
  const report = getEmbeddingSyncReport(job.artifacts)

  if (!report) {
    return null
  }

  return (
    <EmbeddingSyncDetails report={report} job={job} onJobUpdate={onJobUpdate} />
  )
}

export function EmbeddingSyncInlineDetails({
  job,
  onJobUpdate,
}: EmbeddingSyncCardProps) {
  const report = getEmbeddingSyncReport(job.artifacts)

  if (!report) {
    return null
  }

  return (
    <EmbeddingSyncDetails
      report={report}
      job={job}
      onJobUpdate={onJobUpdate}
      variant="inline"
    />
  )
}
