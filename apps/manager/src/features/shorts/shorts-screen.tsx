"use client"

// Shorts Studio list screen: polling jobs table + entry point to the picker.
// Plan 2026-06-11-002 "UI" — clones the smart-crop screen's polling pattern.

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Download, Plus } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
import type { JobRecord } from "@/types/job"
import {
  buildShortsMediaHref,
  canDownloadShortsOutput,
  getShortsJobSummary,
} from "./shorts-presenter"

const SHORTS_POLL_INTERVAL_MS = 5_000

type ShortsScreenProps = {
  initialJobs: JobRecord[]
}

function formatCreatedAt(iso: string): string {
  if (!iso) return "n/a"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}

export function ShortsScreen({ initialJobs }: ShortsScreenProps) {
  const [jobs, setJobs] = useState<JobRecord[]>(initialJobs)

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
          <h2 className="jobs-card-title">Shorts</h2>
        </div>
        {jobs.length === 0 ? (
          <p className="small jobs-empty-state">
            No shorts yet.{" "}
            <Link href="/dashboard/shorts/new">Create your first short</Link>{" "}
            from any library video with a public Mux playback.
          </p>
        ) : (
          <div className="jobs-table-wrap">
            <table className="table jobs-table">
              <thead>
                <tr>
                  <th>Short</th>
                  <th>Source asset</th>
                  <th>Clip</th>
                  <th>Phase</th>
                  <th>Draft</th>
                  <th>Created</th>
                  <th>Output</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const summary = getShortsJobSummary(job)
                  if (!summary) return null
                  return (
                    <tr key={job.id}>
                      <td>
                        <Link href={`/dashboard/shorts/${job.id}`}>
                          {summary.title}
                        </Link>
                      </td>
                      <td>{summary.sourceMuxAssetId}</td>
                      <td>{summary.clipRangeLabel}</td>
                      <td>
                        <span
                          className={`jobs-progress-summary jobs-progress-summary-${summary.phaseTone}`}
                        >
                          {summary.phaseLabel}
                        </span>
                        {summary.annotationLabel ? (
                          <>
                            {" "}
                            <span
                              className="jobs-language-badge jobs-language-badge-muted"
                              title={summary.annotationLabel}
                            >
                              no captions
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td>
                        {summary.report ? (
                          <span
                            title={
                              summary.isStale
                                ? "The draft changed after the last render — re-render to update the output."
                                : undefined
                            }
                          >
                            v{summary.report.draftVersion}
                            {summary.isStale ? (
                              <>
                                {" "}
                                <span className="jobs-language-badge">
                                  stale output
                                </span>
                              </>
                            ) : null}
                          </span>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td>{formatCreatedAt(job.createdAt)}</td>
                      <td>
                        {canDownloadShortsOutput(summary) ? (
                          <a
                            href={buildShortsMediaHref(job.id, "output")}
                            download
                            className="jobs-step-artifact-link"
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
                          "–"
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
