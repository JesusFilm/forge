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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

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

function formatDuration(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) {
    return "–"
  }

  const startMs = Date.parse(startIso)
  const endMs = Date.parse(endIso)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return "–"
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

  const statusBadgeVariant =
    displayJobStatus === "completed"
      ? "success"
      : displayJobStatus === "failed"
        ? "danger"
        : displayJobStatus === "running"
          ? "pending"
          : "outline"

  return (
    <Card>
      <CardContent className="pt-8">
        <div className="grid gap-8 lg:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-3">
            <p className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Status
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge variant={statusBadgeVariant}>{displayJobStatus}</Badge>
              <Badge variant="outline" title={`Retries: ${job.retries}`}>
                {job.retries} retries
              </Badge>
              {job.status === "completed" &&
              hasUnresolvedElevenLabsFailure(transcriptionRoutingReport) ? (
                <Badge variant="danger">ElevenLabs output missing</Badge>
              ) : null}
              {job.errors.length > 0 ? (
                <a
                  href="#error-log"
                  className="text-[0.95rem] font-medium text-[color:var(--ds-brand-red)] underline underline-offset-4"
                >
                  Error log
                </a>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Created
            </p>
            <p className="text-[1rem] leading-7 text-foreground">
              {formatCreatedSummary({
                createdAt: job.createdAt,
                status: displayJobStatus,
                completedAt: job.completedAt,
                updatedAt: job.updatedAt,
              })}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Languages
            </p>
            {languageBadges.length > 0 ? (
              <div
                className="flex flex-wrap items-center gap-2"
                title={languageBadges.map((badge) => badge.text).join(", ")}
              >
                {languageBadges.map((badge) => (
                  <Badge key={`${job.id}-${badge.key}`} variant="outline">
                    {badge.text}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-[1rem] leading-7 text-muted-foreground">
                none
              </span>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Mux ID
            </p>
            <div className="space-y-3">
              <code
                className="block overflow-hidden text-ellipsis whitespace-nowrap rounded-[1rem] border border-border bg-secondary/35 px-4 py-3 text-[0.95rem] text-foreground"
                title={job.muxAssetId}
              >
                {job.muxAssetId}
              </code>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyMuxId}
                  aria-label="Copy Mux ID"
                  title={muxIdCopied ? "Copied" : "Copy Mux ID"}
                >
                  {muxIdCopied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                  {muxIdCopied ? "Copied" : "Copy"}
                </Button>
                {muxWatchUrl ? (
                  <a
                    href={muxWatchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 text-[13px] font-medium tracking-[-0.01em] text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.06)] transition-colors hover:bg-accent"
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    Watch on Mux
                  </a>
                ) : null}
                {muxWatchUrl ? (
                  <span
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium tracking-[-0.01em]",
                      muxEnvironment === "staging"
                        ? "border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.10)] text-[color:#b45309]"
                        : "border-[rgba(239,68,68,0.22)] bg-[rgba(239,68,68,0.08)] text-[color:#b91c1c]",
                    )}
                    title={muxEnvironmentTooltip}
                    aria-label={muxEnvironmentTooltip}
                    tabIndex={0}
                  >
                    <MuxEnvironmentIcon className="size-4" aria-hidden="true" />
                    {muxEnvironmentLabel}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
