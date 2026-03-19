"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Captions,
  Download,
  ExternalLink,
  FileAudio2,
  FileJson2,
  Languages,
  ListOrdered,
  Network,
  RefreshCw,
  type LucideIcon,
} from "lucide-react"
import { formatStepName } from "@/lib/workflow-steps"
import type { JobRecord, StepStatus, WorkflowStepName } from "@/types/job"
import {
  FOREGROUND_POLL_DELAY_MS,
  getNextPollDelayMs,
  shouldApplyPollResult,
} from "./live-jobs-polling"

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

const ARTIFACT_KEYS_BY_STEP: Record<WorkflowStepName, string[]> = {
  download_video: [],
  transcription: ["transcript"],
  structured_transcript: ["subtitlesVtt"],
  subtitle_post_process: [
    "subtitlePostProcessManifest",
    "subtitlesByLanguage",
    "subtitleTheologyByLanguage",
    "subtitleLanguageDeltasByLanguage",
    "subtitleTrackMetadata",
  ],
  chapters: ["chapters"],
  metadata: ["metadata"],
  embeddings: ["embeddings"],
  translation: ["translations"],
  voiceover: ["voiceover"],
  artifact_upload: ["storyboard", "chunks", "artifactManifest"],
  mux_upload: ["muxUpload"],
  cms_notify: [],
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
  voiceover: "Synthesizes voiceover audio from generated text.",
  artifact_upload: "Uploads generated artifacts and writes the manifest.",
  mux_upload: "Publishes output assets to Mux for playback.",
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

function getArtifactsForStep(
  stepName: WorkflowStepName,
  artifacts: Record<string, string>,
): Array<{ key: string; url: string }> {
  const keys = ARTIFACT_KEYS_BY_STEP[stepName]
  return keys
    .map((key) => ({ key, url: artifacts[key] }))
    .filter((entry): entry is { key: string; url: string } =>
      Boolean(entry.url),
    )
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
  }, [initialJob.id, onJobUpdate])

  const handleRefreshNow = useCallback(() => {
    const runPoll = runPollRef.current
    if (!runPoll) return
    void runPoll({ scheduleNext: true })
  }, [])

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
  }, [isPollingError, isRefreshing, lastUpdatedAt])

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
              const stepArtifacts = getArtifactsForStep(
                step.name,
                job.artifacts,
              )
              const StepIcon = getStepLabelIcon(step.name)
              const inlineError = step.error ?? null
              return (
                <React.Fragment key={step.name}>
                  <tr
                    className={inlineError ? "jobs-row-with-issue" : undefined}
                  >
                    <td>
                      <span className="jobs-step-label">
                        <StepIcon
                          className="jobs-step-label-icon"
                          aria-hidden="true"
                          size={24}
                        />
                        <span className="jobs-step-label-text">
                          <span className="jobs-step-label-title">
                            {formatStepName(step.name)}
                          </span>
                          <span className="jobs-step-label-subtitle">
                            {STEP_DESCRIPTION_BY_NAME[step.name]}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>{formatDuration(step.startedAt, step.finishedAt)}</td>
                    <td>
                      {stepArtifacts.length === 0 ? (
                        <span className="jobs-no-issue">–</span>
                      ) : (
                        <div className="jobs-step-artifacts">
                          {stepArtifacts.map((artifact) => (
                            <a
                              key={`${step.name}-${artifact.key}`}
                              href={artifact.url}
                              target="_blank"
                              rel="noreferrer"
                              className="jobs-step-artifact-link"
                              aria-label={`Open ${artifact.key} in a new tab`}
                              title={`Open ${artifact.key} in a new tab`}
                            >
                              <ExternalLink
                                className="jobs-step-artifact-icon"
                                aria-hidden="true"
                                size={14}
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="jobs-step-status-cell">
                        <span
                          className={`jobs-step-status-icon jobs-step-status-icon-${step.status}`}
                          role="img"
                          aria-label={step.status}
                          title={step.status}
                        >
                          <StepStatusGlyph status={step.status} />
                        </span>
                        {step.retries > 0 ? (
                          <span
                            className="jobs-step-retry-pill"
                            title={`${step.retries} retries`}
                          >
                            x {step.retries}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {inlineError && (
                    <tr className="jobs-issue-row">
                      <td colSpan={4}>
                        <p className="jobs-error-text" title={inlineError}>
                          {inlineError}
                        </p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
