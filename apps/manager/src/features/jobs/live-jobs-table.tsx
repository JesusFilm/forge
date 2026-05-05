"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { formatStepName } from "@/lib/workflow-steps"
import type { JobRecord } from "@/types/job"
import { apiFetch } from "@/lib/api-fetch"
import {
  getTranscriptionRoutingReport,
  getUnresolvedElevenLabsFailureReason,
} from "@/lib/transcription-routing-report"
import {
  getDisplayedJobStatus,
  getDisplayedStepStatus,
  formatTime,
  getLanguageBadges,
  getProgressSummary,
  getSourceTitle,
  getStepDotSymbol,
  groupJobsByDay,
} from "./jobs-table-presenter"
import {
  FOREGROUND_POLL_DELAY_MS,
  getNextPollDelayMs,
  shouldApplyPollResult,
} from "./live-jobs-polling"
import { buildJobDetailHref } from "./job-detail-href"

const MAX_VISIBLE_LANGUAGE_BADGES = 6

type LiveJobsTableProps = {
  initialJobs: JobRecord[]
  languageLabelsById: Record<string, string>
}

type RunPollOptions = {
  scheduleNext: boolean
}

const INTERACTIVE_TARGET_SELECTOR =
  'a,button,input,select,textarea,[role="button"],[role="link"]'

function shouldIgnoreRowNavigation(
  target: EventTarget | null,
  rowElement: HTMLElement,
): boolean {
  if (!(target instanceof Element)) return false
  const interactiveTarget = target.closest(INTERACTIVE_TARGET_SELECTOR)
  if (!interactiveTarget) return false
  return interactiveTarget !== rowElement
}

export function LiveJobsTable({
  initialJobs,
  languageLabelsById,
}: LiveJobsTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [jobs, setJobs] = useState(initialJobs)
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false)
  const [isPollingError, setIsPollingError] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const requestSeqRef = useRef(0)
  const timeoutIdRef = useRef<number | null>(null)
  const activeControllerRef = useRef<AbortController | null>(null)
  const runPollRef = useRef<
    ((options: RunPollOptions) => Promise<void>) | null
  >(null)

  const languageLabelMap = useMemo(
    () => new Map<string, string>(Object.entries(languageLabelsById)),
    [languageLabelsById],
  )
  const groupedJobs = useMemo(() => groupJobsByDay(jobs), [jobs])
  const jobsDetailQuerySuffix = useMemo(() => {
    const rawLanguageIds =
      searchParams?.get("languageIds") ?? searchParams?.get("languageId") ?? ""
    const normalizedLanguageIds = [
      ...new Set(
        rawLanguageIds
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ]
    if (normalizedLanguageIds.length === 0) {
      return ""
    }
    return `?languageId=${encodeURIComponent(normalizedLanguageIds.join(","))}`
  }, [searchParams])

  const buildJobHref = useCallback(
    (jobId: string) => buildJobDetailHref(jobId, jobsDetailQuerySuffix),
    [jobsDetailQuerySuffix],
  )

  const prefetchJobHref = useCallback(
    (jobId: string) => {
      router.prefetch(buildJobHref(jobId))
    },
    [buildJobHref, router],
  )

  const navigateToJobHref = useCallback(
    (jobId: string) => {
      router.push(buildJobHref(jobId))
    },
    [buildJobHref, router],
  )

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
      activeControllerRef.current?.abort()
      const controller = new AbortController()
      activeControllerRef.current = controller

      try {
        const response = await apiFetch("/api/jobs?view=summary", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setIsPollingError(true)
          }
          return
        }

        const raw = (await response.json()) as { jobs: JobRecord[] }
        const payload = raw.jobs
        if (
          shouldApplyPollResult({
            cancelled,
            activeRequestSeq: requestSeqRef.current,
            responseSeq,
            aborted: controller.signal.aborted,
          })
        ) {
          setJobs(payload)
          setIsPollingError(false)
          setLastUpdatedAt(new Date().toISOString())
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsPollingError(true)
        }
      } finally {
        if (scheduleNext && !cancelled) {
          scheduleNextPoll()
        }
      }
    }

    runPollRef.current = runPoll
    void runPoll({ scheduleNext: true })

    return () => {
      cancelled = true
      runPollRef.current = null
      clearScheduledPoll()
      activeControllerRef.current?.abort()
    }
  }, [])

  const handleRefreshNow = useCallback(() => {
    const runPoll = runPollRef.current
    if (!runPoll) return
    setIsManualRefreshPending(true)
    void runPoll({ scheduleNext: false }).finally(() => {
      setIsManualRefreshPending(false)
    })
  }, [])

  const liveStatus = useMemo(() => {
    if (isPollingError) {
      return "Auto-update retrying after a network error."
    }
    if (isManualRefreshPending) {
      return "Refreshing jobs now..."
    }
    if (lastUpdatedAt) {
      return `Auto-updating every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s · Last update ${formatTime(lastUpdatedAt)}`
    }
    return `Auto-updating every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s`
  }, [isManualRefreshPending, isPollingError, lastUpdatedAt])

  return (
    <section className="collection-card jobs-card">
      <header className="studio-page-intro studio-page-intro--with-actions">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Job execution</span>
          <h1>Jobs</h1>
          <p>
            Track enrichment runs, workflow progress, language targets, and
            retry status.
          </p>
        </div>
        <div className="studio-page-intro-actions collection-cache-refresh">
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
            disabled={isManualRefreshPending}
          >
            <RefreshCw className="icon" aria-hidden="true" />
            Refresh now
          </button>
        </div>
      </header>

      {jobs.length === 0 ? (
        <p className="small jobs-empty-state">
          No jobs yet. Create one to start the workflow.
        </p>
      ) : (
        <div className="jobs-day-groups">
          {groupedJobs.map((group) => (
            <section key={group.dayKey} className="jobs-day-group">
              <h3 className="jobs-day-heading">{group.dayLabel}</h3>
              <div className="jobs-table-wrap">
                <table className="table jobs-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Source</th>
                      <th>Languages</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.jobs.map((job) => {
                      const displayJobStatus = getDisplayedJobStatus(job)
                      const latestError =
                        displayJobStatus === "failed"
                          ? (job.errors.at(-1)?.message ??
                            getUnresolvedElevenLabsFailureReason(
                              getTranscriptionRoutingReport(job.artifacts),
                            ) ??
                            "Failed")
                          : null
                      const languageBadges = getLanguageBadges(
                        job,
                        languageLabelMap,
                      )
                      const visibleLanguageBadges = languageBadges.slice(
                        0,
                        MAX_VISIBLE_LANGUAGE_BADGES,
                      )
                      const hiddenLanguageCount = Math.max(
                        0,
                        languageBadges.length - MAX_VISIBLE_LANGUAGE_BADGES,
                      )

                      return (
                        <React.Fragment key={job.id}>
                          <tr
                            className={`jobs-clickable-row${latestError ? " jobs-row-with-issue" : ""}`}
                            onMouseEnter={() => prefetchJobHref(job.id)}
                            onFocus={() => prefetchJobHref(job.id)}
                            onClick={(event) => {
                              if (
                                shouldIgnoreRowNavigation(
                                  event.target,
                                  event.currentTarget,
                                )
                              )
                                return
                              navigateToJobHref(job.id)
                            }}
                            onKeyDown={(event) => {
                              if (
                                shouldIgnoreRowNavigation(
                                  event.target,
                                  event.currentTarget,
                                )
                              )
                                return
                              if (event.key !== "Enter" && event.key !== " ")
                                return
                              event.preventDefault()
                              navigateToJobHref(job.id)
                            }}
                            tabIndex={0}
                            role="link"
                            aria-label={`Open job ${job.id}`}
                          >
                            <td>{formatTime(job.createdAt)}</td>
                            <td className="jobs-source-cell">
                              <span
                                className="jobs-source-title"
                                title={getSourceTitle(job)}
                              >
                                {getSourceTitle(job)}
                              </span>
                            </td>
                            <td>
                              {languageBadges.length === 0 ? (
                                <span className="jobs-no-issue">none</span>
                              ) : (
                                <div
                                  className="jobs-language-badges"
                                  title={languageBadges
                                    .map((badge) => badge.text)
                                    .join(", ")}
                                >
                                  {visibleLanguageBadges.map((badge) => (
                                    <span
                                      key={`${job.id}-${badge.key}`}
                                      className="jobs-language-badge"
                                    >
                                      {badge.text}
                                    </span>
                                  ))}
                                  {hiddenLanguageCount > 0 && (
                                    <span className="jobs-language-badge jobs-language-badge-muted">
                                      +{hiddenLanguageCount}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="jobs-progress-cell">
                                <div className="jobs-progress-track">
                                  {job.steps.map((step) => (
                                    <span
                                      key={`${job.id}-${step.name}`}
                                      className={`jobs-step-dot jobs-step-dot-${getDisplayedStepStatus(job, step)}`}
                                      title={formatStepName(step.name)}
                                      aria-label={formatStepName(step.name)}
                                    >
                                      {getStepDotSymbol(
                                        getDisplayedStepStatus(job, step),
                                      )}
                                    </span>
                                  ))}
                                </div>
                                <p
                                  className={`jobs-progress-summary jobs-progress-summary-${displayJobStatus}`}
                                >
                                  {getProgressSummary(job)}
                                </p>
                                <Link
                                  href={buildJobHref(job.id)}
                                  className="jobs-open-link"
                                >
                                  Open
                                </Link>
                              </div>
                            </td>
                          </tr>
                          {latestError && (
                            <tr className="jobs-issue-row">
                              <td aria-hidden="true" />
                              <td colSpan={3}>
                                <p
                                  className="jobs-error-text"
                                  title={latestError}
                                >
                                  {latestError}
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
          ))}
        </div>
      )}
    </section>
  )
}
