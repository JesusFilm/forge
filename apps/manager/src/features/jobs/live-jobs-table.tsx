"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
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
} from "./live-jobs-polling"
import {
  createInitialLiveJobsRealtimeSnapshot,
  createLiveJobsListEventSourceOpener,
  createLiveJobsListRealtimeController,
  type LiveJobsListRealtimeController,
} from "./live-jobs-realtime"

const MAX_VISIBLE_LANGUAGE_BADGES = 6

type LiveJobsTableProps = {
  initialJobs: JobRecord[]
  languageLabelsById: Record<string, string>
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
  const searchParams = useSearchParams()
  const [realtimeSnapshot, setRealtimeSnapshot] = useState(() =>
    createInitialLiveJobsRealtimeSnapshot(initialJobs),
  )
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const controllerRef = useRef<LiveJobsListRealtimeController | null>(null)
  const lastSyncedJobsRef = useRef(initialJobs)
  const lastSyncSourceRef = useRef(realtimeSnapshot.lastSyncSource)

  const languageLabelMap = useMemo(
    () => new Map<string, string>(Object.entries(languageLabelsById)),
    [languageLabelsById],
  )
  const jobs = realtimeSnapshot.state
  const isRefreshing = realtimeSnapshot.isRefreshInFlight
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

  useEffect(() => {
    lastSyncedJobsRef.current = initialJobs
    lastSyncSourceRef.current = "initial"

    const controller = createLiveJobsListRealtimeController({
      initialJobs,
      openStream: createLiveJobsListEventSourceOpener(),
      poll: async (signal) => {
        const response = await apiFetch("/api/jobs?view=summary", {
          cache: "no-store",
          signal,
        })

        if (!response.ok) {
          throw new Error(`Jobs refresh failed (${response.status})`)
        }

        const payload = (await response.json()) as { jobs: JobRecord[] }
        return payload.jobs
      },
      getPollDelayMs: () =>
        getNextPollDelayMs(
          typeof document !== "undefined" &&
            document.visibilityState === "hidden",
        ),
    })

    controllerRef.current = controller

    const unsubscribe = controller.subscribe((snapshot) => {
      const didApplySuccessfulSync =
        snapshot.lastSyncSource !== "initial" &&
        !snapshot.isRefreshInFlight &&
        (snapshot.state !== lastSyncedJobsRef.current ||
          snapshot.lastSyncSource !== lastSyncSourceRef.current)

      setRealtimeSnapshot(snapshot)

      if (didApplySuccessfulSync) {
        setLastUpdatedAt(new Date().toISOString())
      }

      lastSyncedJobsRef.current = snapshot.state
      lastSyncSourceRef.current = snapshot.lastSyncSource
    })

    controller.start()

    return () => {
      unsubscribe()
      controller.stop()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [initialJobs])

  const handleRefreshNow = useCallback(() => {
    void controllerRef.current?.refreshNow()
  }, [])

  const liveStatus = useMemo(() => {
    if (realtimeSnapshot.transportMode === "connecting") {
      return "Connecting live updates..."
    }
    if (
      realtimeSnapshot.isRefreshInFlight &&
      realtimeSnapshot.transportMode !== "polling"
    ) {
      return "Refreshing jobs..."
    }
    if (realtimeSnapshot.transportMode === "polling") {
      const lastUpdateText = lastUpdatedAt
        ? ` · Last update ${formatTime(lastUpdatedAt)}`
        : ""
      return `Live updates reconnecting. Polling every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s${lastUpdateText}`
    }
    if (lastUpdatedAt) {
      return `Live updates connected · Last update ${formatTime(lastUpdatedAt)}`
    }
    return "Live updates connected"
  }, [
    lastUpdatedAt,
    realtimeSnapshot.isRefreshInFlight,
    realtimeSnapshot.transportMode,
  ])

  return (
    <section className="collection-card jobs-card">
      <div className="jobs-card-header">
        <h2 className="jobs-card-title">Jobs</h2>
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
          >
            <RefreshCw className="icon" aria-hidden="true" />
            Refresh now
          </button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="small">No jobs yet. Create one to start the workflow.</p>
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
                            onClick={(event) => {
                              if (
                                shouldIgnoreRowNavigation(
                                  event.target,
                                  event.currentTarget,
                                )
                              )
                                return
                              window.location.assign(
                                `/dashboard/jobs/${job.id}${jobsDetailQuerySuffix}`,
                              )
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
                              window.location.assign(
                                `/dashboard/jobs/${job.id}${jobsDetailQuerySuffix}`,
                              )
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
                                  href={`/dashboard/jobs/${job.id}${jobsDetailQuerySuffix}`}
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
