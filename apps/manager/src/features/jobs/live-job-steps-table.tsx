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
  type LucideIcon,
} from "lucide-react"
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
      <p className="jobs-step-detail-summary">Transcription provider</p>
      {rerunError ? <p className="jobs-error-text">{rerunError}</p> : null}
      <div className="jobs-transcription-routing">
        {report ? (
          <>
            <div className="jobs-transcription-routing-summary">
              <span className="jobs-transcription-summary-pill">
                Final: {report.finalProvider ?? "pending"}
              </span>
              <span className="jobs-transcription-summary-pill">
                Attempts: {report.attempts.length}
              </span>
            </div>
            {report.finalSourceLanguageCode ? (
              <p className="jobs-transcription-routing-note">
                Source language: {report.finalSourceLanguageCode}
              </p>
            ) : null}
            {report.sourceInputHost ? (
              <p className="jobs-transcription-routing-note">
                Source host: {report.sourceInputHost}
              </p>
            ) : null}
            {report.fallbackReason ? (
              <p className="jobs-transcription-routing-note">
                Fell back to Mux after ElevenLabs failed:{" "}
                {report.fallbackReason}
              </p>
            ) : null}
            {report.attempts.length > 0 ? (
              <div className="jobs-transcription-attempts">
                {report.attempts.map((attempt) => (
                  <article
                    key={attempt.attemptId}
                    className="jobs-transcription-attempt-card"
                  >
                    <div className="jobs-transcription-attempt-header">
                      <strong>{attempt.requestedProvider}</strong>
                      <span className="jobs-step-retry-pill">
                        {attempt.status}
                      </span>
                    </div>
                    <p className="jobs-transcription-routing-note">
                      Resolved provider: {attempt.resolvedProvider}
                      {attempt.sourceLanguageCode
                        ? ` / ${attempt.sourceLanguageCode}`
                        : ""}
                    </p>
                    {attempt.decisionReason ? (
                      <p className="jobs-transcription-routing-note">
                        {attempt.decisionReason}
                      </p>
                    ) : null}
                    {attempt.fallbackReason ? (
                      <p className="jobs-transcription-routing-note">
                        {attempt.fallbackReason}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="jobs-transcription-rerun-actions">
          <button
            type="button"
            className="jobs-transcription-rerun-button"
            onClick={() => onRerun("elevenlabs")}
            disabled={isRerunDisabled}
          >
            {rerunProvider === "elevenlabs"
              ? "Rerunning..."
              : "Rerun with ElevenLabs"}
          </button>
          <button
            type="button"
            className="jobs-transcription-rerun-button"
            onClick={() => onRerun("mux")}
            disabled={isRerunDisabled}
          >
            {rerunProvider === "mux" ? "Rerunning..." : "Rerun with Mux"}
          </button>
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
    <section className="collection-card jobs-card">
      <div className="jobs-card-header">
        <div className="jobs-step-header-group">
          <h3 className="jobs-section-title">Step Execution</h3>
          {headingMeta ?? null}
        </div>
        <div className="collection-cache-refresh">
          <span
            className="small jobs-live-status"
            role="status"
            aria-live="polite"
          >
            {liveStatus}
          </span>
          <button
            type="button"
            className="collection-cache-clear jobs-refresh-link"
            onClick={handleRefreshNow}
            disabled={isRefreshing}
            aria-label="Refresh now"
            title="Refresh now"
          >
            <RefreshCw className="icon" aria-hidden="true" />
            Refresh now
          </button>
        </div>
      </div>
      <div className="jobs-table-wrap">
        <table className="table jobs-table jobs-detail-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Duration</th>
              <th>Artifacts</th>
              <th>Status</th>
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
                step.name === "translation" && translationFailures.length > 0
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
                  <span className="jobs-step-inline-summary-text">
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
                detailRowClassName = "jobs-embedding-sync-detail-row"
              } else if (hasTranslationDetails) {
                inlineSummary = translationFailureSummary ? (
                  <span className="jobs-step-inline-summary-note">
                    {translationFailureSummary}
                  </span>
                ) : null
                detailContent = (
                  <>
                    <p className="jobs-step-detail-summary">
                      {translationFailureSummary}
                    </p>
                    <ul className="jobs-step-detail-list">
                      {translationFailures.map((failure) => (
                        <li
                          key={`${step.name}-${failure.lang}`}
                          className="jobs-step-detail-item"
                          title={
                            failure.error
                              ? `${failure.lang}: ${failure.error}`
                              : failure.lang
                          }
                        >
                          <strong>{failure.lang}</strong>
                          {failure.error ? `: ${failure.error}` : null}
                        </li>
                      ))}
                    </ul>
                  </>
                )
              } else if (hasTranscriptionDetails) {
                inlineSummary = transcriptionSummary ? (
                  <span className="jobs-step-inline-summary-note">
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
                    className={
                      muxSyncSummary.needsAttention
                        ? "jobs-step-inline-summary-text"
                        : "jobs-step-inline-summary-note"
                    }
                  >
                    {muxSyncSummary.text}
                  </span>
                ) : null
                detailContent = (
                  <>
                    <p className="jobs-step-detail-summary">
                      Subtitle sync results
                    </p>
                    {overrideError ? (
                      <p className="jobs-error-text">{overrideError}</p>
                    ) : null}
                    <div className="jobs-mux-sync-list">
                      {muxSyncStepComparisons.map((comparison) => {
                        const canOverride = canRetryMuxSyncOverride(comparison)

                        return (
                          <article
                            key={`${step.name}-${comparison.artifactKey}`}
                            className="jobs-mux-sync-card"
                          >
                            <div className="jobs-mux-sync-card-header">
                              <strong>{comparison.targetLanguage}</strong>
                              <span className="jobs-step-retry-pill">
                                {comparison.status}
                              </span>
                            </div>
                            <p className="jobs-mux-sync-explanation">
                              {comparison.explanation}
                            </p>
                            <div className="jobs-mux-sync-previews">
                              <div>
                                <div className="small">Generated</div>
                                <pre className="jobs-mux-sync-preview">
                                  {comparison.generatedPreview ?? "–"}
                                </pre>
                              </div>
                              <div>
                                <div className="small">Mux</div>
                                <pre className="jobs-mux-sync-preview">
                                  {comparison.muxPreview ?? "–"}
                                </pre>
                              </div>
                            </div>
                            {canOverride ? (
                              <button
                                type="button"
                                className="jobs-mux-sync-override"
                                onClick={() =>
                                  void handleSubtitleOverride(comparison)
                                }
                                disabled={
                                  overrideArtifactKey === comparison.artifactKey
                                }
                              >
                                {overrideArtifactKey === comparison.artifactKey
                                  ? "Overriding…"
                                  : comparison.status === "override_pending"
                                    ? "Resume override"
                                    : "Override Mux data"}
                              </button>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  </>
                )
              }

              const commonStepRowProps = {
                stepName: step.name,
                title: formatStepName(step.name),
                description: STEP_DESCRIPTION_BY_NAME[step.name],
                icon: StepIcon,
                duration: formatDuration(step.startedAt, step.finishedAt),
                artifacts: stepArtifacts,
                status: displayedStepStatus,
                statusIcon: <StepStatusGlyph status={displayedStepStatus} />,
                retries: step.retries,
                inlineSummary,
                inlineError,
              } as const

              if (detailContent == null) {
                return (
                  <CollapsibleStepRow key={step.name} {...commonStepRowProps} />
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
    </section>
  )
}
