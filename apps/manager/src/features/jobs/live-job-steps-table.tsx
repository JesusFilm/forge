"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Captions,
  Download,
  FileAudio2,
  FileJson2,
  Languages,
  ListOrdered,
  Network,
  RefreshCw,
  Search,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { getEmbeddingSyncReport } from "@/lib/embedding-sync-report"
import { getSceneEmbeddingSyncReport } from "@/lib/scene-embedding-sync-report"
import {
  getTranscriptionRoutingReport,
  getUnresolvedElevenLabsFailureReason,
  hasUnresolvedElevenLabsFailure,
} from "@/lib/transcription-routing-report"
import { formatStepName } from "@/lib/workflow-steps"
import { canRetryMuxSyncOverride } from "@/lib/mux-sync-override"
import type {
  JobRecord,
  MuxSyncComparison,
  RequestedTranscriptionProvider,
  StepStatus,
  TranscriptionRoutingReport,
  WorkflowStepName,
} from "@/types/job"
import {
  FOREGROUND_POLL_DELAY_MS,
  getNextPollDelayMs,
  shouldApplyPollResult,
} from "./live-jobs-polling"
import { getArtifactsForStep } from "@/lib/job-artifacts"
import {
  EmbeddingSyncInlineDetails,
  shouldExpandEmbeddingSyncByDefault,
} from "./embedding-sync-card"
import {
  hasSceneEmbeddingSyncIssue,
  SceneEmbeddingSyncInlineDetails,
  shouldExpandSceneEmbeddingSyncByDefault,
} from "./scene-embedding-sync-card"
import { getPresentedMuxSyncComparisons } from "@/features/jobs/mux-sync-presenter"
import { CollapsibleStepRow } from "./collapsible-step-row"

type RunPollOptions = {
  scheduleNext: boolean
}

type LiveJobStepsTableProps = {
  initialJob: JobRecord
  headingMeta?: React.ReactNode
  onJobUpdate?: (job: JobRecord) => void
}

function isTerminalJobStatus(status: JobRecord["status"]): boolean {
  return status === "completed" || status === "failed"
}

const STEP_DESCRIPTION_BY_NAME: Record<WorkflowStepName, string> = {
  download_video: "Fetches source media and validates job inputs.",
  transcription: "Generates a timestamped transcript from the source audio.",
  structured_transcript:
    "Builds subtitle-ready VTT and normalized transcript cues.",
  subtitle_post_process:
    "Refines subtitle readability and theology-sensitive wording before delivery.",
  chapters: "Detects chapter boundaries and labels major content sections.",
  metadata: "Extracts summary, tags, and structured content metadata.",
  embeddings: "Creates semantic vectors for search and retrieval.",
  translation: "Translates transcript content into target languages.",
  audio_cleanup: "Prepares original and cleaned audio for manager review.",
  voiceover: "Synthesizes voiceover audio from generated text.",
  artifact_upload: "Uploads generated artifacts and writes the manifest.",
  mux_upload: "Publishes translated subtitle tracks to Mux when needed.",
  theology_validation_bible_quotes:
    "Planned theology validation and Bible Quotes generation; skipped for now.",
  seo_improvements:
    "Future SEO optimization phase. No SEO actions run in this version.",
  cms_notify: "Notifies downstream CMS integrations of completion.",
}

function formatDuration(startedAt?: string, finishedAt?: string): string {
  if (!startedAt || !finishedAt) {
    return "–"
  }

  const startedMs = Date.parse(startedAt)
  const finishedMs = Date.parse(finishedAt)
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) {
    return "–"
  }

  const totalSeconds = Math.max(0, Math.floor((finishedMs - startedMs) / 1000))
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
  if (remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`
  }
  return `${hours}h`
}

function getStepLabelIcon(stepName: WorkflowStepName): LucideIcon {
  switch (stepName) {
    case "download_video":
      return Download
    case "transcription":
      return FileAudio2
    case "structured_transcript":
      return Captions
    case "subtitle_post_process":
      return Captions
    case "chapters":
      return ListOrdered
    case "metadata":
      return FileJson2
    case "embeddings":
      return Network
    case "translation":
      return Languages
    case "seo_improvements":
      return Search
    case "audio_cleanup":
    case "voiceover":
      return FileAudio2
    case "artifact_upload":
    case "mux_upload":
    case "cms_notify":
      return FileJson2
    default:
      return FileJson2
  }
}

function getTranslationFailureDetails(step: JobRecord["steps"][number]): Array<{
  lang: string
  error?: string
}> {
  if (step.name !== "translation") {
    return []
  }

  return (step.details?.languageResults ?? [])
    .filter((result) => result.status === "failed")
    .map((result) => ({
      lang: result.lang,
      error: result.error,
    }))
}

function getTranslationFailureSummary(
  translationFailures: Array<{ lang: string; error?: string }>,
): string | null {
  if (translationFailures.length === 0) {
    return null
  }

  return `${translationFailures.length} target${
    translationFailures.length === 1 ? "" : "s"
  } failed during translation.`
}

function getMuxSyncInlineSummary(
  comparisons: MuxSyncComparison[],
): { text: string; needsAttention: boolean } | null {
  if (comparisons.length === 0) {
    return null
  }

  const needsAttentionCount = comparisons.filter((comparison) =>
    ["failed", "override_pending", "reconciliation_required"].includes(
      comparison.status,
    ),
  ).length

  if (needsAttentionCount > 0) {
    return {
      text: `${needsAttentionCount} subtitle sync result${
        needsAttentionCount === 1 ? "" : "s"
      } ${needsAttentionCount === 1 ? "needs" : "need"} attention.`,
      needsAttention: true,
    }
  }

  return {
    text: `${comparisons.length} subtitle sync comparison${
      comparisons.length === 1 ? "" : "s"
    } available.`,
    needsAttention: false,
  }
}

function getMuxSyncStatusVariant(status: MuxSyncComparison["status"]) {
  if (
    status === "failed" ||
    status === "override_pending" ||
    status === "reconciliation_required"
  ) {
    return "danger" as const
  }

  if (status === "synced" || status === "override_applied") {
    return "success" as const
  }

  return "outline" as const
}

function TranscriptionRoutingInlineDetails({
  report,
  rerunError,
  rerunProvider,
  isRerunDisabled,
  onRerun,
}: {
  report: TranscriptionRoutingReport | undefined
  rerunError: string | null
  rerunProvider: RequestedTranscriptionProvider | null
  isRerunDisabled: boolean
  onRerun: (
    provider: Extract<RequestedTranscriptionProvider, "elevenlabs" | "mux">,
  ) => void
}) {
  return (
    <>
      <p className="text-[1rem] font-semibold tracking-[-0.02em] text-foreground">
        Transcription provider
      </p>
      {rerunError ? (
        <p className="rounded-[18px] border border-[color:rgba(239,51,64,0.16)] bg-[color:rgba(239,51,64,0.08)] px-4 py-3 text-[0.95rem] leading-6 text-[color:var(--ds-brand-red)]">
          {rerunError}
        </p>
      ) : null}
      <div className="space-y-4">
        {report ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="px-3 py-1.5 text-[12px]">
                Final: {report.finalProvider ?? "pending"}
              </Badge>
              <Badge variant="outline" className="px-3 py-1.5 text-[12px]">
                Attempts: {report.attempts.length}
              </Badge>
            </div>
            {report.finalSourceLanguageCode ? (
              <p className="text-[0.95rem] leading-6 text-muted-foreground">
                Source language: {report.finalSourceLanguageCode}
              </p>
            ) : null}
            {report.sourceInputHost ? (
              <p className="text-[0.95rem] leading-6 text-muted-foreground">
                Source host: {report.sourceInputHost}
              </p>
            ) : null}
            {report.fallbackReason ? (
              <p className="text-[0.95rem] leading-6 text-muted-foreground">
                Fell back to Mux after ElevenLabs failed:{" "}
                {report.fallbackReason}
              </p>
            ) : null}
            {report.attempts.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {report.attempts.map((attempt) => (
                  <article
                    key={attempt.attemptId}
                    className="rounded-[1.25rem] border border-border/70 bg-card p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong>{attempt.requestedProvider}</strong>
                      <Badge variant="outline" className="px-2.5 py-1">
                        {attempt.status}
                      </Badge>
                    </div>
                    <p className="mt-3 text-[0.95rem] leading-6 text-muted-foreground">
                      Resolved provider: {attempt.resolvedProvider}
                      {attempt.sourceLanguageCode
                        ? ` / ${attempt.sourceLanguageCode}`
                        : ""}
                    </p>
                    {attempt.decisionReason ? (
                      <p className="mt-2 text-[0.95rem] leading-6 text-muted-foreground">
                        {attempt.decisionReason}
                      </p>
                    ) : null}
                    {attempt.fallbackReason ? (
                      <p className="mt-2 text-[0.95rem] leading-6 text-muted-foreground">
                        {attempt.fallbackReason}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => onRerun("elevenlabs")}
            disabled={isRerunDisabled}
          >
            {rerunProvider === "elevenlabs" ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileAudio2 className="size-4" aria-hidden="true" />
            )}
            {rerunProvider === "elevenlabs"
              ? "Rerunning..."
              : "Rerun with ElevenLabs"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => onRerun("mux")}
            disabled={isRerunDisabled}
          >
            {rerunProvider === "mux" ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Captions className="size-4" aria-hidden="true" />
            )}
            {rerunProvider === "mux" ? "Rerunning..." : "Rerun with Mux"}
          </Button>
        </div>
      </div>
    </>
  )
}

function StepStatusGlyph({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <path
          d="M6 10.2l2.5 2.5L14 7.8"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (status === "running") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.3" />
        <path
          d="M10 2a8 8 0 0 1 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (status === "failed") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <path
          d="M7 7l6 6M13 7l-6 6"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (status === "skipped") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <path
          d="M6.5 10h7"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="currentColor" />
      <path
        d="M8 7v6M12 7v6"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LiveJobStepsTable({
  initialJob,
  headingMeta,
  onJobUpdate,
}: LiveJobStepsTableProps) {
  const [job, setJob] = useState(initialJob)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPollingError, setIsPollingError] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const embeddingSyncReport = useMemo(
    () => getEmbeddingSyncReport(job.artifacts),
    [job.artifacts],
  )
  const sceneEmbeddingSyncReport = useMemo(
    () => getSceneEmbeddingSyncReport(job.artifacts),
    [job.artifacts],
  )
  const transcriptionRoutingReport = useMemo(
    () => getTranscriptionRoutingReport(job.artifacts),
    [job.artifacts],
  )
  const [expandedSteps, setExpandedSteps] = useState<
    Partial<Record<WorkflowStepName, boolean>>
  >(() => ({
    embeddings:
      shouldExpandEmbeddingSyncByDefault(
        getEmbeddingSyncReport(initialJob.artifacts),
      ) ||
      shouldExpandSceneEmbeddingSyncByDefault(
        getSceneEmbeddingSyncReport(initialJob.artifacts),
      ),
  }))
  const [overrideArtifactKey, setOverrideArtifactKey] = useState<string | null>(
    null,
  )
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [rerunProvider, setRerunProvider] =
    useState<RequestedTranscriptionProvider | null>(null)
  const [rerunError, setRerunError] = useState<string | null>(null)

  const requestSeqRef = useRef(0)
  const latestStatusRef = useRef<JobRecord["status"]>(initialJob.status)
  const timeoutIdRef = useRef<number | null>(null)
  const activeControllerRef = useRef<AbortController | null>(null)
  const runPollRef = useRef<
    ((options: RunPollOptions) => Promise<void>) | null
  >(null)

  useEffect(() => {
    let cancelled = false

    const clearScheduledPoll = () => {
      if (timeoutIdRef.current !== null) {
        window.clearTimeout(timeoutIdRef.current)
        timeoutIdRef.current = null
      }
    }

    const scheduleNextPoll = () => {
      if (cancelled) return
      if (isTerminalJobStatus(latestStatusRef.current)) return
      clearScheduledPoll()
      const isDocumentHidden =
        typeof document !== "undefined" && document.visibilityState === "hidden"
      timeoutIdRef.current = window.setTimeout(() => {
        const currentRunPoll = runPollRef.current
        if (!currentRunPoll) return
        void currentRunPoll({ scheduleNext: true })
      }, getNextPollDelayMs(isDocumentHidden))
    }

    const runPoll = async ({ scheduleNext }: RunPollOptions) => {
      const responseSeq = ++requestSeqRef.current
      setIsRefreshing(true)
      activeControllerRef.current?.abort()
      const controller = new AbortController()
      activeControllerRef.current = controller

      try {
        const response = await fetch(
          `/api/jobs/${encodeURIComponent(initialJob.id)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        )
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setIsPollingError(true)
          }
          return
        }

        const raw = (await response.json()) as { job: JobRecord }
        const payload = raw.job
        if (
          shouldApplyPollResult({
            cancelled,
            activeRequestSeq: requestSeqRef.current,
            responseSeq,
            aborted: controller.signal.aborted,
          })
        ) {
          setJob(payload)
          onJobUpdate?.(payload)
          latestStatusRef.current = payload.status
          setIsPollingError(false)
          setLastUpdatedAt(new Date().toISOString())
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsPollingError(true)
        }
      } finally {
        if (responseSeq === requestSeqRef.current) {
          setIsRefreshing(false)
        }
        if (
          scheduleNext &&
          !cancelled &&
          !isTerminalJobStatus(latestStatusRef.current)
        ) {
          scheduleNextPoll()
        }
      }
    }

    runPollRef.current = runPoll
    if (!isTerminalJobStatus(initialJob.status)) {
      void runPoll({ scheduleNext: true })
    }

    return () => {
      cancelled = true
      runPollRef.current = null
      clearScheduledPoll()
      activeControllerRef.current?.abort()
    }
  }, [initialJob.id, initialJob.status, onJobUpdate])

  const handleRefreshNow = useCallback(() => {
    const runPoll = runPollRef.current
    if (!runPoll) return
    void runPoll({ scheduleNext: true })
  }, [])

  const handleJobUpdate = useCallback(
    (nextJob: JobRecord) => {
      setJob(nextJob)
      onJobUpdate?.(nextJob)
    },
    [onJobUpdate],
  )

  useEffect(() => {
    if (
      shouldExpandEmbeddingSyncByDefault(embeddingSyncReport) ||
      shouldExpandSceneEmbeddingSyncByDefault(sceneEmbeddingSyncReport)
    ) {
      setExpandedSteps((current) => ({ ...current, embeddings: true }))
      return
    }

    if (
      !embeddingSyncReport &&
      !hasSceneEmbeddingSyncIssue(sceneEmbeddingSyncReport)
    ) {
      setExpandedSteps((current) => ({ ...current, embeddings: false }))
    }
  }, [embeddingSyncReport, sceneEmbeddingSyncReport])

  const handleToggleStep = useCallback((stepName: WorkflowStepName) => {
    setExpandedSteps((current) => ({
      ...current,
      [stepName]: !current[stepName],
    }))
  }, [])

  const handleSubtitleOverride = useCallback(
    async (comparison: MuxSyncComparison) => {
      setOverrideArtifactKey(comparison.artifactKey)
      setOverrideError(null)

      try {
        const response = await fetch(
          `/api/jobs/${encodeURIComponent(job.id)}/mux-sync/override`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              artifactKey: comparison.artifactKey,
              targetLanguage: comparison.targetLanguage,
            }),
          },
        )

        const payload = (await response.json()) as {
          error?: string
          job?: JobRecord
        }
        if (payload.job) {
          setJob(payload.job)
          onJobUpdate?.(payload.job)
          latestStatusRef.current = payload.job.status
        }

        if (!response.ok) {
          setOverrideError(payload.error ?? "Failed to override subtitle track")
          return
        }

        if (!payload.job) {
          setOverrideError("Failed to override subtitle track")
        }
      } catch {
        setOverrideError("Failed to override subtitle track")
      } finally {
        setOverrideArtifactKey(null)
      }
    },
    [job.id, onJobUpdate],
  )

  const handleTranscriptionRerun = useCallback(
    async (
      provider: Extract<RequestedTranscriptionProvider, "elevenlabs" | "mux">,
    ) => {
      setRerunProvider(provider)
      setRerunError(null)

      try {
        const response = await fetch(
          `/api/jobs/${encodeURIComponent(job.id)}/transcription/rerun`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ provider }),
          },
        )

        const payload = (await response.json()) as {
          error?: string
          job?: JobRecord
        }
        if (payload.job) {
          setJob(payload.job)
          onJobUpdate?.(payload.job)
          latestStatusRef.current = payload.job.status
        }

        if (!response.ok) {
          setRerunError(payload.error ?? "Failed to rerun transcription")
          return
        }

        if (!payload.job) {
          setRerunError("Failed to rerun transcription")
        }
      } catch {
        setRerunError("Failed to rerun transcription")
      } finally {
        setRerunProvider(null)
      }
    },
    [job.id, onJobUpdate],
  )

  const liveStatus = useMemo(() => {
    if (isRefreshing) {
      return "Updating job..."
    }
    if (isTerminalJobStatus(job.status)) {
      return `Auto-update paused (${job.status}).`
    }
    if (isPollingError) {
      return "Auto-update retrying after a network error."
    }
    if (lastUpdatedAt) {
      return `Auto-updating every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s`
    }
    return `Auto-updating every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s`
  }, [isPollingError, isRefreshing, job.status, lastUpdatedAt])

  const muxSyncComparisons = useMemo(
    () => getPresentedMuxSyncComparisons(job),
    [job],
  )

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[1.22rem] font-semibold tracking-[-0.02em] text-foreground">
                Step execution
              </h3>
              {headingMeta ?? null}
            </div>
            <span
              className="text-[13px] leading-5 text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {liveStatus}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleRefreshNow}
            disabled={isRefreshing}
            aria-label="Refresh now"
            title="Refresh now"
          >
            <RefreshCw
              className={cn("size-4", isRefreshing && "animate-spin")}
              aria-hidden="true"
            />
            Refresh now
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0 pt-0">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/70 text-[0.78rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-8 py-4">Step</th>
                  <th className="px-8 py-4">Duration</th>
                  <th className="px-8 py-4">Artifacts</th>
                  <th className="px-8 py-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {job.steps.map((step) => {
                  const muxSyncStepComparisons =
                    step.name === "mux_upload" ? muxSyncComparisons : []
                  const stepArtifacts = getArtifactsForStep(
                    step.name,
                    job.id,
                    job.artifacts,
                  )
                  const StepIcon = getStepLabelIcon(step.name)
                  const transcriptionQualityGateFailed =
                    step.name === "transcription" &&
                    hasUnresolvedElevenLabsFailure(transcriptionRoutingReport)
                  const displayedStepStatus = transcriptionQualityGateFailed
                    ? "failed"
                    : step.status
                  const inlineError =
                    step.error ??
                    (transcriptionQualityGateFailed
                      ? (getUnresolvedElevenLabsFailureReason(
                          transcriptionRoutingReport,
                        ) ??
                        "ElevenLabs transcription did not complete successfully.")
                      : null)
                  const translationFailures = getTranslationFailureDetails(step)
                  const hasSceneEmbeddingDetails = hasSceneEmbeddingSyncIssue(
                    sceneEmbeddingSyncReport,
                  )
                  const hasEmbeddingDetails =
                    step.name === "embeddings" &&
                    (embeddingSyncReport != null || hasSceneEmbeddingDetails)
                  const hasTranslationDetails =
                    step.name === "translation" &&
                    translationFailures.length > 0
                  const hasTranscriptionDetails =
                    step.name === "transcription" &&
                    (transcriptionRoutingReport != null || rerunError != null)
                  const hasMuxUploadDetails =
                    step.name === "mux_upload" &&
                    (muxSyncStepComparisons.length > 0 || overrideError != null)
                  const isExpanded = expandedSteps[step.name] ?? false
                  const translationFailureSummary =
                    getTranslationFailureSummary(translationFailures)
                  const transcriptionSummary =
                    transcriptionRoutingReport != null
                      ? `Final provider: ${
                          transcriptionRoutingReport.finalProvider ?? "pending"
                        }. ${
                          transcriptionRoutingReport.attempts.length === 1
                            ? "1 attempt"
                            : `${transcriptionRoutingReport.attempts.length} attempts`
                        }.`
                      : null
                  const muxSyncSummary = overrideError
                    ? {
                        text: "Subtitle sync override failed.",
                        needsAttention: true,
                      }
                    : getMuxSyncInlineSummary(muxSyncStepComparisons)
                  let inlineSummary: React.ReactNode = null
                  let detailContent: React.ReactNode = null
                  let detailRowClassName: string | undefined

                  if (hasEmbeddingDetails) {
                    const showInlineEmbeddingSummary =
                      (embeddingSyncReport != null &&
                        embeddingSyncReport.status === "failed") ||
                      hasSceneEmbeddingDetails

                    inlineSummary = showInlineEmbeddingSummary ? (
                      <span className="text-[0.94rem] font-medium leading-6 text-[color:var(--ds-brand-red)]">
                        {embeddingSyncReport
                          ? "CMS sync needs attention."
                          : "Scene sync needs attention."}
                      </span>
                    ) : null
                    detailContent = (
                      <>
                        {embeddingSyncReport ? (
                          <EmbeddingSyncInlineDetails
                            job={job}
                            onJobUpdate={handleJobUpdate}
                          />
                        ) : null}
                        {hasSceneEmbeddingDetails ? (
                          <SceneEmbeddingSyncInlineDetails job={job} />
                        ) : null}
                      </>
                    )
                    detailRowClassName = "space-y-5"
                  } else if (hasTranslationDetails) {
                    inlineSummary = translationFailureSummary ? (
                      <span className="text-[0.94rem] leading-6 text-muted-foreground">
                        {translationFailureSummary}
                      </span>
                    ) : null
                    detailContent = (
                      <>
                        <p className="text-[0.96rem] leading-6 text-foreground">
                          {translationFailureSummary}
                        </p>
                        <ul className="list-disc space-y-2 pl-5 text-[0.95rem] leading-6 text-muted-foreground">
                          {translationFailures.map((failure) => (
                            <li
                              key={`${step.name}-${failure.lang}`}
                              title={
                                failure.error
                                  ? `${failure.lang}: ${failure.error}`
                                  : failure.lang
                              }
                            >
                              <strong className="text-foreground">
                                {failure.lang}
                              </strong>
                              {failure.error ? `: ${failure.error}` : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    )
                  } else if (hasTranscriptionDetails) {
                    inlineSummary = transcriptionSummary ? (
                      <span className="text-[0.94rem] leading-6 text-muted-foreground">
                        {transcriptionSummary}
                      </span>
                    ) : null
                    detailContent = (
                      <TranscriptionRoutingInlineDetails
                        report={transcriptionRoutingReport}
                        rerunError={rerunError}
                        rerunProvider={rerunProvider}
                        isRerunDisabled={
                          rerunProvider != null ||
                          (job.status === "running" &&
                            job.currentStep === "transcription")
                        }
                        onRerun={(provider) =>
                          void handleTranscriptionRerun(provider)
                        }
                      />
                    )
                  } else if (hasMuxUploadDetails) {
                    inlineSummary = muxSyncSummary ? (
                      <span
                        className={cn(
                          muxSyncSummary.needsAttention
                            ? "text-[0.94rem] font-medium leading-6 text-[color:var(--ds-brand-red)]"
                            : "text-[0.94rem] leading-6 text-muted-foreground",
                        )}
                      >
                        {muxSyncSummary.text}
                      </span>
                    ) : null
                    detailContent = (
                      <>
                        <p className="text-[0.96rem] font-medium tracking-[-0.01em] text-foreground">
                          Subtitle sync results
                        </p>
                        {overrideError ? (
                          <p className="rounded-[18px] border border-[color:rgba(239,51,64,0.16)] bg-[color:rgba(239,51,64,0.08)] px-4 py-3 text-[0.95rem] leading-6 text-[color:var(--ds-brand-red)]">
                            {overrideError}
                          </p>
                        ) : null}
                        <div className="space-y-3">
                          {muxSyncStepComparisons.map((comparison) => {
                            const canOverride =
                              canRetryMuxSyncOverride(comparison)

                            return (
                              <article
                                key={`${step.name}-${comparison.artifactKey}`}
                                className="space-y-4 rounded-[1.35rem] border border-border/70 bg-card p-5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <strong className="text-[1rem] font-semibold tracking-[-0.02em] text-foreground">
                                    {comparison.targetLanguage}
                                  </strong>
                                  <Badge
                                    variant={getMuxSyncStatusVariant(
                                      comparison.status,
                                    )}
                                    className="px-2.5 py-1"
                                  >
                                    {comparison.status}
                                  </Badge>
                                </div>
                                <p className="text-[0.95rem] leading-6 text-muted-foreground">
                                  {comparison.explanation}
                                </p>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div>
                                    <div className="mb-2 text-[0.76rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                      Generated
                                    </div>
                                    <pre className="min-h-[6.5rem] whitespace-pre-wrap break-words rounded-[1rem] border border-border/60 bg-secondary/20 p-3 font-mono text-[12px] leading-5 text-muted-foreground">
                                      {comparison.generatedPreview ?? "–"}
                                    </pre>
                                  </div>
                                  <div>
                                    <div className="mb-2 text-[0.76rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                      Mux
                                    </div>
                                    <pre className="min-h-[6.5rem] whitespace-pre-wrap break-words rounded-[1rem] border border-border/60 bg-secondary/20 p-3 font-mono text-[12px] leading-5 text-muted-foreground">
                                      {comparison.muxPreview ?? "–"}
                                    </pre>
                                  </div>
                                </div>
                                {canOverride ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="md"
                                    onClick={() =>
                                      void handleSubtitleOverride(comparison)
                                    }
                                    disabled={
                                      overrideArtifactKey ===
                                      comparison.artifactKey
                                    }
                                  >
                                    {overrideArtifactKey ===
                                    comparison.artifactKey ? (
                                      <RefreshCw
                                        className="size-4 animate-spin"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <RefreshCw
                                        className="size-4"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {overrideArtifactKey ===
                                    comparison.artifactKey
                                      ? "Overriding…"
                                      : comparison.status === "override_pending"
                                        ? "Resume override"
                                        : "Override Mux data"}
                                  </Button>
                                ) : null}
                              </article>
                            )
                          })}
                        </div>
                      </>
                    )
                    detailRowClassName = "space-y-5"
                  }

                  const commonStepRowProps = {
                    stepName: step.name,
                    title: formatStepName(step.name),
                    description: STEP_DESCRIPTION_BY_NAME[step.name],
                    icon: StepIcon,
                    duration: formatDuration(step.startedAt, step.finishedAt),
                    artifacts: stepArtifacts,
                    status: displayedStepStatus,
                    statusIcon: (
                      <StepStatusGlyph status={displayedStepStatus} />
                    ),
                    retries: step.retries,
                    inlineSummary,
                    inlineError,
                  } as const

                  if (detailContent == null) {
                    return (
                      <CollapsibleStepRow
                        key={step.name}
                        {...commonStepRowProps}
                      />
                    )
                  }

                  return (
                    <CollapsibleStepRow
                      key={step.name}
                      {...commonStepRowProps}
                      isExpanded={isExpanded}
                      onToggle={() => handleToggleStep(step.name)}
                      detailContent={detailContent}
                      detailRowClassName={detailRowClassName}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
