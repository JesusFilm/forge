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
import {
  getTranscriptionRoutingReport,
  getUnresolvedElevenLabsFailureReason,
  hasUnresolvedElevenLabsFailure,
} from "@/lib/transcription-routing-report"
import { formatStepName } from "@/lib/workflow-steps"
import { canRetryMuxSyncOverride } from "@/lib/mux-sync-override"
import type {
  JobRecord,
  MastraStepCorrelation,
  MuxSyncComparison,
  RequestedTranscriptionProvider,
  StepStatus,
  SubtitleValidationStepSummary,
  TranscriptionRoutingReport,
  WorkflowStepName,
} from "@/types/job"
import type { TranscriptScriptureCorrectionStepSummary } from "@/lib/transcript-scripture-correction"
import {
  FOREGROUND_POLL_DELAY_MS,
  getNextPollDelayMs,
} from "./live-jobs-polling"
import {
  createInitialLiveJobsRealtimeSnapshot,
  createLiveJobDetailEventSourceOpener,
  createLiveJobDetailRealtimeController,
  type LiveJobsDetailRealtimeController,
} from "./live-jobs-realtime"
import { getArtifactsForStep } from "@/lib/job-artifacts"
import { getPresentedMuxSyncComparisons } from "@/features/jobs/mux-sync-presenter"
import { CollapsibleStepRow } from "./collapsible-step-row"

type LiveJobStepsTableProps = {
  initialJob: JobRecord
  headingMeta?: React.ReactNode
  onJobUpdate?: (job: JobRecord) => void
}

// Exported for reuse by other step tables (e.g. the Shorts Studio detail) —
// single source of truth for step description copy.
export const STEP_DESCRIPTION_BY_NAME: Record<WorkflowStepName, string> = {
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
  audio_cleanup:
    "Cleans source audio before transcription and stores review artifacts.",
  voiceover: "Synthesizes voiceover audio from generated text.",
  artifact_upload: "Uploads generated artifacts and writes the manifest.",
  mux_upload: "Publishes translated subtitle tracks to Mux when needed.",
  theology_validation_bible_quotes:
    "Planned theology validation and Bible Quotes generation; skipped for now.",
  seo_improvements:
    "Future SEO optimization phase. No SEO actions run in this version.",
  cms_notify: "Notifies downstream CMS integrations of completion.",
  smart_crop_fingerprint:
    "Builds the visual fingerprint (shot boundaries + perceptual hashes).",
  smart_crop_plan: "Generates the AI canonical 9:16 crop plan per shot batch.",
  smart_crop_align:
    "Aligns localized shots to the canonical fingerprint with confidence gates.",
  smart_crop_preview_render:
    "Renders a sampled 9:16 preview through the crop worker.",
  smart_crop_qa: "Runs AI review over the rendered preview frames.",
  smart_crop_render: "Renders the full 9:16 output through the crop worker.",
  smart_crop_mux_output: "Creates the Mux output asset from the rendered file.",
  shorts_prepare:
    "Trims the source clip and generates whisper word captions via the shorts worker.",
  shorts_render: "Renders the 1080x1920 short through the shorts worker.",
  shorts_mux_output: "Creates the Mux output asset from the rendered short.",
}

// Exported for reuse by other job UIs (shorts steps table, detail header).
export function formatDuration(
  startedAt?: string,
  finishedAt?: string,
): string {
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

function getMastraInlineSummary(
  mastra: MastraStepCorrelation | undefined,
): string | null {
  if (!mastra) {
    return null
  }

  return mastra.status
    ? `Mastra run ${mastra.runId} (${mastra.status}).`
    : `Mastra run ${mastra.runId}.`
}

function getSubtitleValidationInlineSummary(
  validation: SubtitleValidationStepSummary | undefined,
): string | null {
  if (!validation || validation.languagesChecked === 0) {
    return null
  }

  if (validation.needsReviewCount > 0) {
    return `${validation.needsReviewCount} scripture validation finding${
      validation.needsReviewCount === 1 ? "" : "s"
    } need review.`
  }

  if (validation.warningCount > 0) {
    return `${validation.warningCount} scripture validation warning${
      validation.warningCount === 1 ? "" : "s"
    }.`
  }

  if (validation.unavailableLanguages.length > 0) {
    return `Scripture validation unavailable for ${validation.unavailableLanguages.join(", ")}.`
  }

  if (validation.modelOnlyLanguages.length > 0) {
    return `Scripture validation passed with model knowledge for ${validation.modelOnlyLanguages.join(", ")}.`
  }

  return "Scripture validation passed."
}

function SubtitleValidationInlineDetails({
  validation,
}: {
  validation: SubtitleValidationStepSummary
}) {
  return (
    <>
      <p className="jobs-step-detail-summary">Subtitle scripture validation</p>
      <ul className="jobs-step-detail-list">
        {validation.results.map((result) => (
          <li
            key={`subtitle-validation-${result.lang}`}
            className="jobs-step-detail-item"
          >
            <strong>{result.lang}</strong>
            {`: ${result.verdict} (${result.basis}, confidence ${Math.round(
              result.confidence * 100,
            )}%)`}
            {result.fallbackReason
              ? `; fallback ${result.fallbackReason}`
              : null}
            {result.unavailableReason
              ? `; unavailable ${result.unavailableReason}`
              : null}
          </li>
        ))}
      </ul>
    </>
  )
}

function getTranscriptCorrectionInlineSummary(
  correction: TranscriptScriptureCorrectionStepSummary | undefined,
): { text: string; needsAttention: boolean } | null {
  if (!correction) return null

  if (correction.status === "unavailable") {
    return {
      text: `Transcript correction unavailable${
        correction.unavailableReason ? `: ${correction.unavailableReason}` : ""
      }.`,
      needsAttention: true,
    }
  }

  if (correction.appliedCount > 0) {
    return {
      text: `${correction.appliedCount} source correction${
        correction.appliedCount === 1 ? "" : "s"
      } applied${
        correction.flaggedCount > 0
          ? `; ${correction.flaggedCount} flagged`
          : ""
      }.`,
      needsAttention: correction.flaggedCount > 0,
    }
  }

  if (correction.flaggedCount > 0) {
    return {
      text: `${correction.flaggedCount} transcript correction finding${
        correction.flaggedCount === 1 ? "" : "s"
      } need review.`,
      needsAttention: true,
    }
  }

  return {
    text:
      correction.status === "skipped"
        ? "No source scripture correction applied."
        : "Transcript correction reviewed.",
    needsAttention: false,
  }
}

function TranscriptCorrectionInlineDetails({
  correction,
}: {
  correction: TranscriptScriptureCorrectionStepSummary
}) {
  return (
    <>
      <p className="jobs-step-detail-summary">
        Source transcript scripture correction
      </p>
      <ul className="jobs-step-detail-list">
        <li className="jobs-step-detail-item">
          <strong>Status</strong>
          {`: ${correction.status} (${correction.basis}, confidence ${Math.round(
            correction.confidence * 100,
          )}%)`}
        </li>
        {correction.unavailableReason ? (
          <li className="jobs-step-detail-item">
            <strong>Unavailable</strong>: {correction.unavailableReason}
          </li>
        ) : null}
        {correction.skippedReason ? (
          <li className="jobs-step-detail-item">
            <strong>Skipped</strong>: {correction.skippedReason}
          </li>
        ) : null}
        {correction.findings.map((finding) => (
          <li
            key={`${finding.action}-${finding.segmentIndex}-${finding.originalText}`}
            className="jobs-step-detail-item"
          >
            <strong>
              {finding.action === "applied" ? "Applied" : "Flagged"} segment{" "}
              {finding.segmentIndex}
            </strong>
            {`: ${finding.originalText}`}
            {finding.correctedText ? ` -> ${finding.correctedText}` : ""}
            {finding.reference ? ` (${finding.reference})` : ""}
          </li>
        ))}
      </ul>
    </>
  )
}

function MastraStepInlineDetails({
  mastra,
}: {
  mastra: MastraStepCorrelation
}) {
  const rows = [
    { label: "Run ID", value: mastra.runId },
    { label: "Status", value: mastra.status },
    { label: "Reason", value: mastra.reason },
    {
      label: "Retryable",
      value:
        mastra.retryable === undefined ? undefined : String(mastra.retryable),
    },
    { label: "Provider", value: mastra.provider },
    { label: "Model", value: mastra.model },
    {
      label: "Chunks",
      value: mastra.chunks === undefined ? undefined : String(mastra.chunks),
    },
    {
      label: "Total tokens",
      value:
        mastra.totalTokens === undefined
          ? undefined
          : String(mastra.totalTokens),
    },
    { label: "Source hash", value: mastra.sourceContentHash },
    {
      label: "Languages",
      value: mastra.languages?.length ? mastra.languages.join(", ") : undefined,
    },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value))

  return (
    <>
      <p className="jobs-step-detail-summary">Mastra run diagnostics</p>
      <ul className="jobs-step-detail-list">
        {rows.map((row) => (
          <li key={row.label} className="jobs-step-detail-item">
            <strong>{row.label}</strong>: {row.value}
          </li>
        ))}
      </ul>
    </>
  )
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
            {rerunProvider === "elevenlabs" ? (
              <RefreshCw className="icon is-spinning" aria-hidden="true" />
            ) : (
              <FileAudio2 className="icon" aria-hidden="true" />
            )}
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
            {rerunProvider === "mux" ? (
              <RefreshCw className="icon is-spinning" aria-hidden="true" />
            ) : (
              <Captions className="icon" aria-hidden="true" />
            )}
            {rerunProvider === "mux" ? "Rerunning..." : "Rerun with Mux"}
          </button>
        </div>
      </div>
    </>
  )
}

// Exported for reuse by other step tables (e.g. the Shorts Studio detail).
export function StepStatusGlyph({ status }: { status: StepStatus }) {
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
  const [realtimeSnapshot, setRealtimeSnapshot] = useState(() =>
    createInitialLiveJobsRealtimeSnapshot(initialJob),
  )
  const job = realtimeSnapshot.state
  const transcriptionRoutingReport = useMemo(
    () => getTranscriptionRoutingReport(job.artifacts),
    [job.artifacts],
  )
  const [expandedSteps, setExpandedSteps] = useState<
    Partial<Record<WorkflowStepName, boolean>>
  >({})
  const [overrideArtifactKey, setOverrideArtifactKey] = useState<string | null>(
    null,
  )
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [rerunProvider, setRerunProvider] =
    useState<RequestedTranscriptionProvider | null>(null)
  const [rerunError, setRerunError] = useState<string | null>(null)

  const controllerRef = useRef<LiveJobsDetailRealtimeController | null>(null)
  const lastSyncedJobRef = useRef(initialJob)

  useEffect(() => {
    lastSyncedJobRef.current = initialJob

    const controller = createLiveJobDetailRealtimeController({
      initialJob,
      openStream: createLiveJobDetailEventSourceOpener({
        jobId: initialJob.id,
      }),
      poll: async (signal) => {
        const response = await fetch(
          `/api/jobs/${encodeURIComponent(initialJob.id)}`,
          {
            cache: "no-store",
            signal,
          },
        )

        if (!response.ok) {
          throw new Error(`Job refresh failed (${response.status})`)
        }

        const payload = (await response.json()) as { job: JobRecord }
        return payload.job
      },
      getPollDelayMs: () =>
        getNextPollDelayMs(
          typeof document !== "undefined" &&
            document.visibilityState === "hidden",
        ),
    })

    controllerRef.current = controller

    const unsubscribe = controller.subscribe((snapshot) => {
      const didStateChange = snapshot.state !== lastSyncedJobRef.current

      setRealtimeSnapshot(snapshot)

      if (didStateChange) {
        lastSyncedJobRef.current = snapshot.state
        onJobUpdate?.(snapshot.state)
      }
    })

    controller.start()

    return () => {
      unsubscribe()
      controller.stop()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [initialJob, onJobUpdate])

  const replaceJobState = useCallback(
    (nextJob: JobRecord) => {
      lastSyncedJobRef.current = nextJob
      onJobUpdate?.(nextJob)

      if (controllerRef.current) {
        controllerRef.current.replaceState(nextJob)
        return
      }

      setRealtimeSnapshot((current) => ({
        ...current,
        state: nextJob,
        lastSyncSource: "external",
      }))
    },
    [onJobUpdate],
  )

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
          replaceJobState(payload.job)
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
    [job.id, replaceJobState],
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
          replaceJobState(payload.job)
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
    [job.id, replaceJobState],
  )

  const liveStatus = useMemo(() => {
    if (realtimeSnapshot.transportMode === "connecting") {
      return "Connecting live updates..."
    }
    if (realtimeSnapshot.transportMode === "polling") {
      if (realtimeSnapshot.isPollingPaused) {
        return `Live updates reconnecting. Polling paused (${job.status})`
      }

      return `Live updates reconnecting. Polling every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s`
    }
    return "Live updates connected"
  }, [
    job.status,
    realtimeSnapshot.isPollingPaused,
    realtimeSnapshot.transportMode,
  ])

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
              const mastraCorrelation =
                step.name === "translation" ||
                step.name === "embeddings" ||
                step.name === "structured_transcript"
                  ? step.details?.mastra
                  : undefined
              const subtitleValidation =
                step.name === "translation"
                  ? step.details?.subtitleValidation
                  : undefined
              const transcriptCorrection =
                step.name === "structured_transcript"
                  ? step.details?.transcriptCorrection
                  : undefined
              const hasMastraDetails = mastraCorrelation != null
              const hasEmbeddingDetails =
                step.name === "embeddings" && hasMastraDetails
              const hasTranslationDetails =
                step.name === "translation" &&
                (translationFailures.length > 0 ||
                  hasMastraDetails ||
                  subtitleValidation != null)
              const hasStructuredTranscriptDetails =
                step.name === "structured_transcript" &&
                (transcriptCorrection != null || hasMastraDetails)
              const hasTranscriptionDetails =
                step.name === "transcription" &&
                (transcriptionRoutingReport != null || rerunError != null)
              const hasMuxUploadDetails =
                step.name === "mux_upload" &&
                (muxSyncStepComparisons.length > 0 || overrideError != null)
              const isExpanded = expandedSteps[step.name] ?? false
              const translationFailureSummary =
                getTranslationFailureSummary(translationFailures)
              const mastraSummary = getMastraInlineSummary(mastraCorrelation)
              const subtitleValidationSummary =
                getSubtitleValidationInlineSummary(subtitleValidation)
              const transcriptCorrectionSummary =
                getTranscriptCorrectionInlineSummary(transcriptCorrection)
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
                inlineSummary = mastraSummary ? (
                  <span className="jobs-step-inline-summary-note">
                    {mastraSummary}
                  </span>
                ) : null
                detailContent = (
                  <>
                    {mastraCorrelation ? (
                      <MastraStepInlineDetails mastra={mastraCorrelation} />
                    ) : null}
                  </>
                )
                detailRowClassName = "jobs-embedding-sync-detail-row"
              } else if (hasStructuredTranscriptDetails) {
                inlineSummary = transcriptCorrectionSummary ? (
                  <span
                    className={
                      transcriptCorrectionSummary.needsAttention
                        ? "jobs-step-inline-summary-text"
                        : "jobs-step-inline-summary-note"
                    }
                  >
                    {transcriptCorrectionSummary.text}
                  </span>
                ) : mastraSummary ? (
                  <span className="jobs-step-inline-summary-note">
                    {mastraSummary}
                  </span>
                ) : null
                detailContent = (
                  <>
                    {mastraCorrelation ? (
                      <MastraStepInlineDetails mastra={mastraCorrelation} />
                    ) : null}
                    {transcriptCorrection ? (
                      <TranscriptCorrectionInlineDetails
                        correction={transcriptCorrection}
                      />
                    ) : null}
                  </>
                )
              } else if (hasTranslationDetails) {
                inlineSummary = translationFailureSummary ? (
                  <span className="jobs-step-inline-summary-note">
                    {translationFailureSummary}
                  </span>
                ) : subtitleValidationSummary ? (
                  <span
                    className={
                      subtitleValidation?.highestVerdict === "needs_review" ||
                      subtitleValidation?.highestVerdict === "warning"
                        ? "jobs-step-inline-summary-text"
                        : "jobs-step-inline-summary-note"
                    }
                  >
                    {subtitleValidationSummary}
                  </span>
                ) : mastraSummary ? (
                  <span className="jobs-step-inline-summary-note">
                    {mastraSummary}
                  </span>
                ) : null
                detailContent = (
                  <>
                    {mastraCorrelation ? (
                      <MastraStepInlineDetails mastra={mastraCorrelation} />
                    ) : null}
                    {subtitleValidation ? (
                      <SubtitleValidationInlineDetails
                        validation={subtitleValidation}
                      />
                    ) : null}
                    {translationFailureSummary ? (
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
                    ) : null}
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
                                {overrideArtifactKey ===
                                comparison.artifactKey ? (
                                  <RefreshCw
                                    className="icon is-spinning"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <RefreshCw
                                    className="icon"
                                    aria-hidden="true"
                                  />
                                )}
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
