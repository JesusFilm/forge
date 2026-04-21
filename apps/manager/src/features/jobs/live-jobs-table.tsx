"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  PageDescription,
  PageEyebrow,
  PageIntro,
  PageTitle,
} from "@/components/ui/page-intro"
import { cn } from "@/lib/utils"
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

const STEP_STATUS_DOT_CLASSNAMES: Record<string, string> = {
  pending: "border-border bg-card text-muted-foreground",
  running:
    "border-[color:rgba(37,99,235,0.18)] bg-[color:rgba(37,99,235,0.12)] text-[color:#2563eb]",
  completed:
    "border-[color:rgba(29,185,84,0.18)] bg-[color:rgba(29,185,84,0.12)] text-[color:#15803d]",
  failed:
    "border-[color:rgba(239,51,64,0.2)] bg-[color:rgba(239,51,64,0.12)] text-[color:var(--ds-brand-red)]",
  skipped: "border-border bg-secondary text-muted-foreground",
}

const JOB_SUMMARY_CLASSNAMES: Record<string, string> = {
  pending: "text-muted-foreground",
  running: "text-[color:#2563eb]",
  completed: "text-[color:#15803d]",
  failed: "text-[color:var(--ds-brand-red)]",
}

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
  const [jobs, setJobs] = useState(initialJobs)
  const [isRefreshing, setIsRefreshing] = useState(false)
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
      setIsRefreshing(true)
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
        if (responseSeq === requestSeqRef.current) {
          setIsRefreshing(false)
        }
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
    void runPoll({ scheduleNext: false })
  }, [])

  const liveStatus = useMemo(() => {
    if (isPollingError) {
      return "Auto-update retrying after a network error."
    }
    if (isRefreshing) {
      return "Updating jobs..."
    }
    if (lastUpdatedAt) {
      return `Auto-updating every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s · Last update ${formatTime(lastUpdatedAt)}`
    }
    return `Auto-updating every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s`
  }, [isPollingError, isRefreshing, lastUpdatedAt])

  return (
    <section className="space-y-8">
      <PageIntro
        actions={
          <>
            <span
              className="max-w-[24rem] text-[13px] leading-5 text-muted-foreground sm:text-[14px]"
              role="status"
              aria-live="polite"
            >
              {liveStatus}
            </span>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleRefreshNow}
              disabled={isRefreshing}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh now
            </Button>
          </>
        }
      >
        <PageEyebrow>Job execution</PageEyebrow>
        <PageTitle className="text-[clamp(3.25rem,8vw,5rem)]">Jobs</PageTitle>
        <PageDescription className="max-w-3xl">
          Track enrichment runs, workflow progress, language targets, and retry
          status.
        </PageDescription>
      </PageIntro>

      {jobs.length === 0 ? (
        <p className="text-[15px] leading-7 text-muted-foreground">
          No jobs yet. Create one to start the workflow.
        </p>
      ) : (
        <div className="space-y-8">
          {groupedJobs.map((group) => (
            <section key={group.dayKey} className="space-y-3">
              <h3 className="text-[1rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {group.dayLabel}
              </h3>
              <Card>
                <CardContent className="px-0 pb-0 pt-0">
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-border/70 text-[0.78rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          <th className="px-8 py-4">Time</th>
                          <th className="px-8 py-4">Source</th>
                          <th className="px-8 py-4">Languages</th>
                          <th className="px-8 py-4">Progress</th>
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
                                className={cn(
                                  "group cursor-pointer border-b border-border/60 align-top transition-colors hover:bg-secondary/20",
                                  latestError &&
                                    "bg-[color:rgba(239,51,64,0.03)] hover:bg-[color:rgba(239,51,64,0.06)]",
                                )}
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
                                  if (
                                    event.key !== "Enter" &&
                                    event.key !== " "
                                  )
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
                                <td className="px-8 py-5 text-[0.95rem] leading-6 text-muted-foreground">
                                  {formatTime(job.createdAt)}
                                </td>
                                <td className="px-8 py-5">
                                  <span
                                    className="line-clamp-2 text-[1rem] font-medium tracking-[-0.02em] text-foreground"
                                    title={getSourceTitle(job)}
                                  >
                                    {getSourceTitle(job)}
                                  </span>
                                </td>
                                <td className="px-8 py-5">
                                  {languageBadges.length === 0 ? (
                                    <span className="text-[0.95rem] leading-6 text-muted-foreground">
                                      none
                                    </span>
                                  ) : (
                                    <div
                                      className="flex flex-wrap gap-2"
                                      title={languageBadges
                                        .map((badge) => badge.text)
                                        .join(", ")}
                                    >
                                      {visibleLanguageBadges.map((badge) => (
                                        <Badge
                                          key={`${job.id}-${badge.key}`}
                                          variant="neutral"
                                          className="px-3 py-1.5 text-[12px]"
                                        >
                                          {badge.text}
                                        </Badge>
                                      ))}
                                      {hiddenLanguageCount > 0 && (
                                        <Badge
                                          variant="outline"
                                          className="px-3 py-1.5 text-[12px]"
                                        >
                                          +{hiddenLanguageCount}
                                        </Badge>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="px-8 py-5">
                                  <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                      {job.steps.map((step) => (
                                        <span
                                          key={`${job.id}-${step.name}`}
                                          className={cn(
                                            "inline-flex size-7 items-center justify-center rounded-full border text-[0.8rem] font-medium",
                                            STEP_STATUS_DOT_CLASSNAMES[
                                              getDisplayedStepStatus(job, step)
                                            ],
                                          )}
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
                                      className={cn(
                                        "text-[0.95rem] font-medium leading-6",
                                        JOB_SUMMARY_CLASSNAMES[
                                          displayJobStatus
                                        ],
                                      )}
                                    >
                                      {getProgressSummary(job)}
                                    </p>
                                    <Link
                                      href={`/dashboard/jobs/${job.id}${jobsDetailQuerySuffix}`}
                                      className="inline-flex w-fit items-center rounded-full border border-border bg-card px-4 py-2 text-[0.92rem] font-medium text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition-colors hover:bg-accent"
                                    >
                                      Open
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                              {latestError && (
                                <tr className="border-b border-border/60">
                                  <td aria-hidden="true" />
                                  <td colSpan={3} className="px-8 pb-5 pr-8">
                                    <p
                                      className="rounded-[18px] border border-[color:rgba(239,51,64,0.16)] bg-[color:rgba(239,51,64,0.08)] px-4 py-3 text-[0.95rem] leading-6 text-[color:var(--ds-brand-red)]"
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
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
