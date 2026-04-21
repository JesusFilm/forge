"use client"

import React, { useState } from "react"
import { Network, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"
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
    <div className="flex items-start justify-between gap-4 border-b border-border/70 py-3 last:border-b-0 last:pb-0 first:pt-0">
      <span className="text-[0.85rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "max-w-[16rem] text-right text-[0.98rem] leading-6 text-foreground",
          mono && "font-mono text-[0.88rem]",
        )}
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
    <Card
      className={cn(
        variant === "inline"
          ? "rounded-[1.5rem] border-dashed bg-card shadow-none"
          : undefined,
      )}
    >
      {variant === "inline" ? (
        <CardHeader className="pb-5">
          <h4 className="text-[1.1rem] font-semibold tracking-[-0.02em] text-foreground">
            Transcript Embeddings CMS Sync
          </h4>
          {showExplanation ? (
            <p className="text-[0.98rem] leading-7 text-muted-foreground">
              {getEmbeddingSyncExplanation(report)}
            </p>
          ) : null}
        </CardHeader>
      ) : (
        <CardHeader className="border-b border-border/70 pb-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4">
              <span className="inline-flex size-11 items-center justify-center rounded-[1rem] border border-border bg-secondary/30">
                <Network size={18} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
                  Transcript Embeddings CMS Sync
                </h3>
                <p className="mt-2 text-[0.98rem] leading-7 text-muted-foreground">
                  {getEmbeddingSyncExplanation(report)}
                </p>
              </div>
            </div>
            <div>
              <Badge
                variant={
                  report.status === "failed"
                    ? "danger"
                    : report.status === "skipped_existing"
                      ? "pending"
                      : "success"
                }
                className="px-3.5 py-1.5 text-[13px]"
              >
                {report.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
      )}

      <CardContent className="pt-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[1.5rem] border border-border bg-secondary/18 p-5">
            <h4 className="text-[1rem] font-semibold tracking-[-0.015em] text-foreground">
              Generated Transcript Artifact
            </h4>
            <div className="mt-5">
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
          </div>

          <div className="rounded-[1.5rem] border border-border bg-secondary/18 p-5">
            <h4 className="text-[1rem] font-semibold tracking-[-0.015em] text-foreground">
              CMS Transcript Vector Index
            </h4>
            <div className="mt-5">
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
        </div>

        {actionMessage ? (
          <p
            className={cn(
              "mt-5 rounded-[1.25rem] border px-4 py-3 text-[0.95rem] leading-6",
              actionMessage.tone === "success" &&
                "border-[rgba(29,185,84,0.2)] bg-[rgba(29,185,84,0.08)] text-[#15803d]",
              actionMessage.tone === "warning" &&
                "border-border bg-secondary text-muted-foreground",
              actionMessage.tone === "error" &&
                "border-[rgba(239,51,64,0.2)] bg-[rgba(239,51,64,0.08)] text-[var(--ds-brand-red)]",
              actionMessage.tone === "neutral" &&
                "border-border bg-secondary/25 text-muted-foreground",
            )}
          >
            {actionMessage.text}
          </p>
        ) : null}

        {canOverride ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="primary"
              onClick={handleOverride}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  <span>Reindexing...</span>
                </>
              ) : (
                <>
                  <Network className="size-4" aria-hidden="true" />
                  <span>Override CMS Transcript Embeddings</span>
                </>
              )}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
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
