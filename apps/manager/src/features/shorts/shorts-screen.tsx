"use client"

// Shorts Studio list screen: polling jobs table + entry point to the picker.
// Plan 2026-06-11-002 "UI" — clones the smart-crop screen's polling pattern.

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Download, ExternalLink, Plus } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
import type { JobRecord } from "@/types/job"
import {
  buildSourceWatchHref,
  buildShortsMediaHref,
  canDownloadShortsOutput,
  getShortsJobSummary,
} from "./shorts-presenter"

const SHORTS_POLL_INTERVAL_MS = 5_000

type ShortsScreenProps = {
  initialJobs: JobRecord[]
}

type OutputPreviewState = {
  href: string
  title: string
} | null

const CREATED_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
})

const CREATED_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
})

function formatCreatedAt(iso: string): { date: string; time: string | null } {
  if (!iso) return { date: "n/a", time: null }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return { date: "n/a", time: null }
  return {
    date: CREATED_DATE_FORMATTER.format(date),
    time: CREATED_TIME_FORMATTER.format(date),
  }
}

export function ShortsScreen({ initialJobs }: ShortsScreenProps) {
  const [jobs, setJobs] = useState<JobRecord[]>(initialJobs)
  const [outputPreview, setOutputPreview] = useState<OutputPreviewState>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch("/api/shorts/jobs", {
        cache: "no-store",
      })
      if (!response.ok) return
      const payload = (await response.json()) as { jobs: JobRecord[] }
      setJobs(payload.jobs ?? [])
    } catch {
      // transient polling failure — keep the previous snapshot
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      // Skip background-tab polls; the next visible tick refreshes.
      if (document.visibilityState === "hidden") return
      void refresh()
    }, SHORTS_POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  return (
    <>
      <header className="studio-page-intro studio-page-intro--with-actions">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Media generation</span>
          <h1>Shorts Studio</h1>
          <p>
            Cut a library video into a branded 9:16 short with word-level
            animated captions, preview it live, then render and publish to Mux.
          </p>
        </div>
        <div className="studio-page-intro-actions">
          <Link href="/dashboard/shorts/new" className="jobs-primary-button">
            <Plus className="icon" aria-hidden="true" />
            Create short
          </Link>
        </div>
      </header>

      <section className="collection-card jobs-card">
        <div className="jobs-card-header">
          <div>
            <h2 className="jobs-card-title">Shorts</h2>
            <p className="shorts-table-summary">
              {jobs.length} {jobs.length === 1 ? "short" : "shorts"}
            </p>
          </div>
        </div>
        {jobs.length === 0 ? (
          <p className="small jobs-empty-state">
            No shorts yet.{" "}
            <Link href="/dashboard/shorts/new">Create your first short</Link>{" "}
            from any library video with a public Mux playback.
          </p>
        ) : (
          <div className="jobs-table-wrap">
            <table className="table jobs-table shorts-jobs-table">
              <thead>
                <tr>
                  <th className="shorts-jobs-col-short">Short</th>
                  <th className="shorts-jobs-col-source">Source video</th>
                  <th className="shorts-jobs-col-language">Languages</th>
                  <th className="shorts-jobs-col-clip">Clip</th>
                  <th className="shorts-jobs-col-phase">Phase</th>
                  <th className="shorts-jobs-col-draft">Draft</th>
                  <th className="shorts-jobs-col-created">Created</th>
                  <th className="shorts-jobs-col-output">Output</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const summary = getShortsJobSummary(job)
                  if (!summary) return null
                  const createdAt = formatCreatedAt(job.createdAt)
                  const sourceSlugLabel =
                    summary.sourceSlug ?? summary.sourceCoreId ?? "No slug"
                  const sourceWatchHref = buildSourceWatchHref(summary)
                  const outputHref = buildShortsMediaHref(job.id, "output")
                  return (
                    <tr key={job.id}>
                      <td className="shorts-jobs-col-short">
                        <Link
                          href={`/dashboard/shorts/${job.id}`}
                          className="shorts-job-title"
                          title={summary.title}
                        >
                          {summary.title}
                        </Link>
                      </td>
                      <td className="shorts-jobs-col-source">
                        <div className="shorts-source-cell">
                          <div className="shorts-source-title-row">
                            {summary.sourceVideoTitle ? (
                              <span
                                className="shorts-source-title"
                                title={summary.sourceVideoTitle}
                              >
                                {summary.sourceVideoTitle}
                              </span>
                            ) : null}
                            {sourceWatchHref ? (
                              <a
                                href={sourceWatchHref}
                                target="_blank"
                                rel="noreferrer"
                                className="shorts-source-watch-link"
                                title="Open source video on Watch"
                              >
                                <ExternalLink size={14} aria-hidden="true" />
                                <span className="sr-only">
                                  Open source video on Watch
                                </span>
                              </a>
                            ) : null}
                          </div>
                          <code
                            className="shorts-source-slug"
                            title={
                              summary.sourceSlug ??
                              summary.sourceCoreId ??
                              summary.sourceMuxAssetId
                            }
                          >
                            {sourceSlugLabel}
                          </code>
                        </div>
                      </td>
                      <td className="shorts-jobs-col-language">
                        <span
                          className="shorts-language-chip"
                          title={summary.languageLabel}
                          aria-label={summary.languageLabel}
                        >
                          {summary.languageFlagUrl ? (
                            <span
                              className="shorts-language-flag"
                              style={{
                                backgroundImage: `url(${summary.languageFlagUrl})`,
                              }}
                              aria-hidden="true"
                            />
                          ) : (
                            <span
                              className="shorts-language-flag shorts-language-flag-empty"
                              aria-hidden="true"
                            />
                          )}
                          <span className="shorts-language-code">
                            {summary.languageShortLabel}
                          </span>
                        </span>
                      </td>
                      <td className="shorts-jobs-col-clip">
                        <span className="shorts-clip-range">
                          {summary.clipRangeLabel}
                        </span>
                      </td>
                      <td className="shorts-jobs-col-phase">
                        <div className="shorts-phase-stack">
                          <span
                            className={`shorts-status-pill shorts-status-pill-${summary.phaseTone}`}
                          >
                            {summary.phaseLabel}
                          </span>
                          {summary.annotationLabel ? (
                            <span
                              className="shorts-status-pill shorts-status-pill-muted"
                              title={summary.annotationLabel}
                            >
                              No captions
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="shorts-jobs-col-draft">
                        {summary.report ? (
                          <span
                            className="shorts-draft-state"
                            title={
                              summary.isStale
                                ? "The draft changed after the last render — re-render to update the output."
                                : undefined
                            }
                          >
                            v{summary.report.draftVersion}
                            {summary.isStale ? (
                              <span className="shorts-inline-badge">Stale</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="shorts-muted-dash">–</span>
                        )}
                      </td>
                      <td className="shorts-jobs-col-created">
                        <time
                          className="shorts-created-at"
                          dateTime={job.createdAt || undefined}
                        >
                          <span>{createdAt.date}</span>
                          {createdAt.time ? (
                            <span>{createdAt.time}</span>
                          ) : null}
                        </time>
                      </td>
                      <td className="shorts-jobs-col-output">
                        {canDownloadShortsOutput(summary) ? (
                          <a
                            href={outputHref}
                            download
                            className="jobs-step-artifact-link shorts-output-link"
                            onMouseEnter={() =>
                              setOutputPreview({
                                href: outputHref,
                                title: summary.title,
                              })
                            }
                            onMouseLeave={() => setOutputPreview(null)}
                            onFocus={() =>
                              setOutputPreview({
                                href: outputHref,
                                title: summary.title,
                              })
                            }
                            onBlur={() => setOutputPreview(null)}
                          >
                            <Download
                              className="jobs-step-artifact-icon"
                              aria-hidden="true"
                              size={14}
                            />
                            <span className="jobs-step-artifact-label">
                              MP4
                            </span>
                          </a>
                        ) : (
                          <span className="shorts-muted-dash">–</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {outputPreview ? (
          <div
            className="shorts-output-preview-modal"
            role="dialog"
            aria-label={`Output preview for ${outputPreview.title}`}
          >
            <div className="shorts-output-preview-panel">
              <div className="shorts-output-preview-header">
                <span>Output preview</span>
                <strong>{outputPreview.title}</strong>
              </div>
              <div className="shorts-output-preview-video-frame">
                <video
                  key={outputPreview.href}
                  src={outputPreview.href}
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                />
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}
