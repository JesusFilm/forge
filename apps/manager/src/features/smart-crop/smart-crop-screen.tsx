"use client"

// Smart Crop dashboard screen: two creation forms (canonical / localized) and
// a polling jobs table. Plan 2026-06-09-002 "UI".

import React, { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Crop, Languages, RefreshCw, Search } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
import type { SmartCropVideoResolution } from "@/app/api/smart-crop/videos/[coreId]/route"
import type { JobRecord, SmartCropCropMode } from "@/types/job"
import { getSmartCropJobSummary } from "./smart-crop-presenter"

const SMART_CROP_POLL_INTERVAL_MS = 5_000
const VIDEO_PICKER_RESULT_LIMIT = 40

const CROP_MODES: SmartCropCropMode[] = [
  "auto",
  "speaker",
  "group",
  "object",
  "slide_aware",
]

type RequestStatus =
  | { type: "idle" }
  | { type: "success"; message: string; jobId: string }
  | { type: "error"; message: string }

type SmartCropScreenProps = {
  initialJobs: JobRecord[]
}

type VideoPickerItem = {
  id: string
  coreId: string | null
  title: string
  slug: string | null
  imageUrl: string | null
  label: string
}

type VideosApiItem = VideoPickerItem

type VideosApiResponse = {
  collections: Array<VideosApiItem & { videos: VideosApiItem[] }>
  standalone: VideosApiItem[]
}

function flattenVideoPickerItems(
  payload: VideosApiResponse,
): VideoPickerItem[] {
  const byId = new Map<string, VideoPickerItem>()
  const add = (item: VideosApiItem) => {
    if (!byId.has(item.id)) {
      byId.set(item.id, {
        id: item.id,
        coreId: item.coreId,
        title: item.title,
        slug: item.slug,
        imageUrl: item.imageUrl,
        label: item.label,
      })
    }
  }

  for (const collection of payload.collections ?? []) {
    add(collection)
    for (const video of collection.videos ?? []) {
      add(video)
    }
  }
  for (const video of payload.standalone ?? []) {
    add(video)
  }

  return [...byId.values()].sort((left, right) =>
    left.title.localeCompare(right.title),
  )
}

function describeVideoResolutionIssue(
  reason: SmartCropVideoResolution["reason"],
): string {
  switch (reason) {
    case "missing_mux_asset":
      return "No Mux asset"
    case "invalid_mux_asset":
      return "Invalid Mux asset"
    default:
      return "Cannot use this video"
  }
}

function formatUpdatedAt(iso: string): string {
  if (!iso) return "n/a"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}

async function createSmartCropJob(
  body: Record<string, unknown>,
): Promise<{ ok: true; jobId: string } | { ok: false; message: string }> {
  const response = await apiFetch("/api/smart-crop/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => ({}))) as {
    job?: { id?: string }
    error?: string
    reason?: string
  }

  if (!response.ok || !payload.job?.id) {
    const message = [payload.error, payload.reason]
      .filter((value): value is string => Boolean(value))
      .join(" | ")
    return { ok: false, message: message || "Failed to create smart-crop job" }
  }

  return { ok: true, jobId: payload.job.id }
}

function CropModeSelect({
  value,
  onChange,
}: {
  value: SmartCropCropMode
  onChange: (mode: SmartCropCropMode) => void
}) {
  return (
    <label className="jobs-field">
      <div className="small jobs-field-label">Crop mode</div>
      <select
        className="jobs-input"
        value={value}
        onChange={(event) => onChange(event.target.value as SmartCropCropMode)}
      >
        {CROP_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>
    </label>
  )
}

function FormStatus({ status }: { status: RequestStatus }) {
  if (status.type === "idle") {
    return null
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className={`small jobs-status ${status.type === "error" ? "jobs-status-error" : "jobs-status-success"}`}
    >
      {status.message}{" "}
      {status.type === "success" ? (
        <Link href={`/dashboard/smart-crop/${status.jobId}`}>Open job</Link>
      ) : null}
    </p>
  )
}

function CanonicalJobForm({ onCreated }: { onCreated: () => void }) {
  const [videos, setVideos] = useState<VideoPickerItem[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [query, setQuery] = useState("")
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [rowIssues, setRowIssues] = useState<Record<string, string>>({})
  const [selectedVideo, setSelectedVideo] = useState<{
    coreId: string
    title: string
    slug: string | null
    muxAssetId: string
  } | null>(null)
  const [muxAssetId, setMuxAssetId] = useState("")
  const [assetId, setAssetId] = useState("")
  const [playbackId, setPlaybackId] = useState("")
  const [cropMode, setCropMode] = useState<SmartCropCropMode>("auto")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<RequestStatus>({ type: "idle" })

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await apiFetch("/api/videos", {
          signal: controller.signal,
        })
        if (!response.ok) {
          setLoadFailed(true)
          return
        }
        const payload = (await response.json()) as VideosApiResponse
        setVideos(flattenVideoPickerItems(payload))
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true)
      }
    })()
    return () => controller.abort()
  }, [])

  const filteredVideos = useMemo(() => {
    if (!videos) return []
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return []

    return videos
      .filter((video) =>
        [video.title, video.slug ?? "", video.coreId ?? "", video.id].some(
          (value) => value.toLowerCase().includes(needle),
        ),
      )
      .slice(0, VIDEO_PICKER_RESULT_LIMIT)
  }, [query, videos])

  const resolveVideo = useCallback(async (video: VideoPickerItem) => {
    if (!video.coreId) {
      setRowIssues((current) => ({
        ...current,
        [video.id]: "No Core ID",
      }))
      return
    }

    setResolvingId(video.id)
    try {
      const response = await apiFetch(
        `/api/smart-crop/videos/${encodeURIComponent(video.coreId)}`,
        { cache: "no-store" },
      )
      const payload = (await response.json().catch(() => ({}))) as
        | SmartCropVideoResolution
        | { error?: string; reason?: string }

      if (!response.ok) {
        const failure = payload as { error?: string; reason?: string }
        setRowIssues((current) => ({
          ...current,
          [video.id]:
            failure.error ??
            `Could not resolve video (${failure.reason ?? response.status}).`,
        }))
        return
      }

      const resolution = payload as SmartCropVideoResolution
      if (!resolution.eligible || !resolution.muxAssetId) {
        setRowIssues((current) => ({
          ...current,
          [video.id]: describeVideoResolutionIssue(resolution.reason),
        }))
        return
      }

      setMuxAssetId(resolution.muxAssetId)
      setSelectedVideo({
        coreId: resolution.coreId,
        title: video.title,
        slug: video.slug,
        muxAssetId: resolution.muxAssetId,
      })
      setQuery("")
      setStatus({ type: "idle" })
      setRowIssues((current) => {
        const next = { ...current }
        delete next[video.id]
        return next
      })
    } catch {
      setRowIssues((current) => ({
        ...current,
        [video.id]: "Could not resolve video",
      }))
    } finally {
      setResolvingId(null)
    }
  }, [])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setStatus({ type: "idle" })

    const result = await createSmartCropJob({
      kind: "canonical",
      muxAssetId: muxAssetId.trim(),
      ...(assetId.trim() ? { assetId: assetId.trim() } : {}),
      ...(playbackId.trim() ? { playbackId: playbackId.trim() } : {}),
      cropMode,
    }).catch(() => ({ ok: false as const, message: "Request failed" }))

    if (result.ok) {
      setStatus({
        type: "success",
        jobId: result.jobId,
        message: `Canonical job ${result.jobId} created.`,
      })
      onCreated()
    } else {
      setStatus({ type: "error", message: result.message })
    }
    setIsSubmitting(false)
  }

  return (
    <form onSubmit={onSubmit} className="collection-card jobs-card jobs-form">
      <div className="jobs-card-header">
        <h2 className="jobs-card-title">Canonical crop plan</h2>
      </div>
      <label className="jobs-field smart-crop-video-search">
        <div className="small jobs-field-label">
          <Search
            size={12}
            aria-hidden="true"
            className="smart-crop-video-search-icon"
          />{" "}
          Video search
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="jobs-input"
          placeholder="Title or slug"
        />
      </label>

      {loadFailed ? (
        <p className="jobs-error-text">Could not load the video library.</p>
      ) : query.trim().length > 0 && videos === null ? (
        <p className="small jobs-empty-state">Loading video library...</p>
      ) : query.trim().length > 0 && filteredVideos.length === 0 ? (
        <p className="small jobs-empty-state">
          No videos match <span>{query.trim()}</span>.
        </p>
      ) : query.trim().length > 0 ? (
        <div className="jobs-table-wrap smart-crop-picker-results">
          <table className="table jobs-table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Type</th>
                <th>Core ID</th>
                <th aria-label="Resolution" />
              </tr>
            </thead>
            <tbody>
              {filteredVideos.map((video) => {
                const issue = rowIssues[video.id]
                const isResolving = resolvingId === video.id
                return (
                  <tr
                    key={video.id}
                    className={
                      issue ? "smart-crop-picker-row-issue" : undefined
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="jobs-step-artifact-link smart-crop-picker-video-button"
                        disabled={resolvingId !== null}
                        onClick={() => void resolveVideo(video)}
                        title={issue ?? `Use ${video.title}`}
                      >
                        {video.imageUrl ? (
                          // Keep admin-sourced URLs in an img src, not CSS.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="smart-crop-picker-thumb"
                            src={video.imageUrl}
                            alt=""
                            aria-hidden="true"
                            loading="lazy"
                          />
                        ) : (
                          <span
                            className="smart-crop-picker-thumb"
                            aria-hidden="true"
                          />
                        )}
                        <span className="smart-crop-picker-title">
                          <span className="jobs-step-artifact-label">
                            {video.title}
                          </span>
                          {video.slug ? (
                            <span className="small smart-crop-picker-slug">
                              {video.slug}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="jobs-language-badge">{video.label}</span>
                    </td>
                    <td>{video.coreId ?? "n/a"}</td>
                    <td>
                      {isResolving ? (
                        <RefreshCw
                          className="icon is-spinning"
                          aria-hidden="true"
                          size={14}
                        />
                      ) : issue ? (
                        <span className="jobs-error-text small">{issue}</span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {selectedVideo ? (
        <p className="small smart-crop-selected-video">
          Selected {selectedVideo.title}
          {selectedVideo.slug ? ` / ${selectedVideo.slug}` : ""} /{" "}
          {selectedVideo.muxAssetId}
        </p>
      ) : null}

      <div className="grid cols-2 jobs-form-grid">
        <label className="jobs-field">
          <div className="small jobs-field-label">Mux Asset ID</div>
          <input
            value={muxAssetId}
            onChange={(e) => {
              setMuxAssetId(e.target.value)
              setSelectedVideo(null)
            }}
            required
            className="jobs-input"
          />
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">Asset ID (optional)</div>
          <input
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className="jobs-input"
            placeholder="defaults to Mux asset id"
          />
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">Playback ID (optional)</div>
          <input
            value={playbackId}
            onChange={(e) => setPlaybackId(e.target.value)}
            className="jobs-input"
            placeholder="resolved from Mux when empty"
          />
        </label>
        <CropModeSelect value={cropMode} onChange={setCropMode} />
      </div>
      <div className="jobs-actions">
        <button
          type="submit"
          disabled={muxAssetId.trim().length === 0 || isSubmitting}
          className="jobs-primary-button"
        >
          {isSubmitting ? (
            <RefreshCw className="icon is-spinning" aria-hidden="true" />
          ) : (
            <Crop className="icon" aria-hidden="true" />
          )}
          {isSubmitting ? "Creating..." : "Start canonical job"}
        </button>
      </div>
      <FormStatus status={status} />
    </form>
  )
}

function LocalizedJobForm({ onCreated }: { onCreated: () => void }) {
  const [muxAssetId, setMuxAssetId] = useState("")
  const [assetId, setAssetId] = useState("")
  const [canonicalAssetId, setCanonicalAssetId] = useState("")
  const [language, setLanguage] = useState("")
  const [cropMode, setCropMode] = useState<SmartCropCropMode>("auto")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<RequestStatus>({ type: "idle" })

  const canSubmit =
    muxAssetId.trim().length > 0 &&
    canonicalAssetId.trim().length > 0 &&
    language.trim().length > 0 &&
    !isSubmitting

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setStatus({ type: "idle" })

    const result = await createSmartCropJob({
      kind: "localized",
      muxAssetId: muxAssetId.trim(),
      canonicalAssetId: canonicalAssetId.trim(),
      language: language.trim(),
      ...(assetId.trim() ? { assetId: assetId.trim() } : {}),
      cropMode,
    }).catch(() => ({ ok: false as const, message: "Request failed" }))

    if (result.ok) {
      setStatus({
        type: "success",
        jobId: result.jobId,
        message: `Localized job ${result.jobId} created.`,
      })
      onCreated()
    } else {
      setStatus({ type: "error", message: result.message })
    }
    setIsSubmitting(false)
  }

  return (
    <form onSubmit={onSubmit} className="collection-card jobs-card jobs-form">
      <div className="jobs-card-header">
        <h2 className="jobs-card-title">Localized 9:16 output</h2>
      </div>
      <div className="grid cols-2 jobs-form-grid">
        <label className="jobs-field">
          <div className="small jobs-field-label">Localized Mux Asset ID</div>
          <input
            value={muxAssetId}
            onChange={(e) => setMuxAssetId(e.target.value)}
            required
            className="jobs-input"
          />
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">Canonical Asset ID</div>
          <input
            value={canonicalAssetId}
            onChange={(e) => setCanonicalAssetId(e.target.value)}
            required
            className="jobs-input"
            placeholder="assetId of the approved canonical plan"
          />
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">Language</div>
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            required
            className="jobs-input"
            placeholder="uk"
          />
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">Asset ID (optional)</div>
          <input
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className="jobs-input"
            placeholder="defaults to Mux asset id"
          />
        </label>
        <CropModeSelect value={cropMode} onChange={setCropMode} />
      </div>
      <div className="jobs-actions">
        <button
          type="submit"
          disabled={!canSubmit}
          className="jobs-primary-button"
        >
          {isSubmitting ? (
            <RefreshCw className="icon is-spinning" aria-hidden="true" />
          ) : (
            <Languages className="icon" aria-hidden="true" />
          )}
          {isSubmitting ? "Creating..." : "Start localized job"}
        </button>
      </div>
      <FormStatus status={status} />
    </form>
  )
}

export function SmartCropScreen({ initialJobs }: SmartCropScreenProps) {
  const [jobs, setJobs] = useState<JobRecord[]>(initialJobs)

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch("/api/smart-crop/jobs", {
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
    const id = window.setInterval(
      () => void refresh(),
      SMART_CROP_POLL_INTERVAL_MS,
    )
    return () => window.clearInterval(id)
  }, [refresh])

  return (
    <>
      <header className="studio-page-intro">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Media generation</span>
          <h1>Smart Crop</h1>
          <p>
            Convert Mux videos into 9:16 verticals: canonical AI crop plans,
            operator approval, and localized reuse via shot alignment.
          </p>
        </div>
      </header>

      <div className="grid cols-2">
        <CanonicalJobForm onCreated={() => void refresh()} />
        <LocalizedJobForm onCreated={() => void refresh()} />
      </div>

      <section className="collection-card jobs-card">
        <div className="jobs-card-header">
          <h2 className="jobs-card-title">Smart Crop jobs</h2>
        </div>
        {jobs.length === 0 ? (
          <p className="small jobs-empty-state">
            No smart-crop jobs yet. Create a canonical job to start.
          </p>
        ) : (
          <div className="jobs-table-wrap">
            <table className="table jobs-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Kind</th>
                  <th>Asset</th>
                  <th>Language</th>
                  <th>Status</th>
                  <th>Phase</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const summary = getSmartCropJobSummary(job)
                  if (!summary) return null
                  return (
                    <tr key={job.id}>
                      <td>
                        <Link href={`/dashboard/smart-crop/${job.id}`}>
                          {job.id}
                        </Link>
                      </td>
                      <td>
                        <span className="jobs-language-badge">
                          {summary.kind}
                        </span>
                      </td>
                      <td>{summary.assetId}</td>
                      <td>{summary.language ?? "—"}</td>
                      <td>
                        <span
                          className={`jobs-progress-summary jobs-progress-summary-${job.status}`}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td>{summary.phaseLabel}</td>
                      <td>{formatUpdatedAt(job.updatedAt)}</td>
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
