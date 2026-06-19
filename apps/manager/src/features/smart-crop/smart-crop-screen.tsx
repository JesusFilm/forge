"use client"

// Smart Crop dashboard screen: two creation forms (canonical / localized) and
// a polling jobs table. Plan 2026-06-09-002 "UI".

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  Crop,
  ExternalLink,
  Film,
  Languages,
  LockKeyhole,
  MoreVertical,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { createPortal } from "react-dom"
import { apiFetch } from "@/lib/api-fetch"
import type { SmartCropVideoResolution } from "@/app/api/smart-crop/videos/[coreId]/route"
import type { JobRecord, SmartCropCropMode } from "@/types/job"
import {
  getSmartCropJobSummary,
  type SmartCropJobSummary,
} from "./smart-crop-presenter"

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

function formatRelativeActivity(iso: string, now: number | null): string {
  if (!iso) return "n/a"
  const timestamp = new Date(iso).getTime()
  if (Number.isNaN(timestamp)) return "n/a"
  if (now === null) return formatUpdatedAt(iso)

  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (elapsedMinutes < 1) return "Just now"
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours} hr${elapsedHours === 1 ? "" : "s"} ago`
  }
  if (elapsedHours < 48) return "Yesterday"

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) {
    return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`
  }

  return formatUpdatedAt(iso)
}

type SmartCropTone = "danger" | "neutral" | "running" | "success" | "warning"

type SmartCropStatusDisplay = {
  label: string
  detail: string
  tone: SmartCropTone
}

type SmartCropProgressDisplay = {
  label: string
  percent: number
  tone: SmartCropTone
}

function getSmartCropSourceTitle(job: JobRecord): string {
  return (
    job.sourceMediaTitle ??
    job.sourceCollectionTitle ??
    job.videoDocumentId ??
    job.options.smartCrop?.assetId ??
    job.muxAssetId
  )
}

function getSmartCropRowSubtitle(
  job: JobRecord,
  summary: SmartCropJobSummary,
): string {
  const bits = [
    summary.kind === "canonical" ? "Master source" : "Localized source",
    job.sourceLanguageCode?.toUpperCase(),
    summary.assetId,
  ].filter(Boolean)

  return bits.join(" / ")
}

function getSmartCropThumbnailUrl(job: JobRecord): string | null {
  if (!job.muxPlaybackId || job.muxPlaybackId.startsWith("mock")) {
    return null
  }

  return `https://image.mux.com/${encodeURIComponent(job.muxPlaybackId)}/thumbnail.webp?width=320&time=3`
}

function getSmartCropStatusDisplay(
  job: JobRecord,
  summary: SmartCropJobSummary,
): SmartCropStatusDisplay {
  if (job.status === "failed") {
    return {
      label: "Failed",
      detail:
        job.errors.at(-1)?.message ?? `${summary.phaseLabel} did not complete`,
      tone: "danger",
    }
  }

  if (job.status === "running") {
    return {
      label: summary.kind === "localized" ? "Rendering" : "Processing",
      detail: `${summary.phaseLabel} in progress`,
      tone: "running",
    }
  }

  if (job.status === "pending") {
    return {
      label: "Queued",
      detail: "Waiting for workflow",
      tone: "neutral",
    }
  }

  const needsPlanReview =
    summary.kind === "canonical" &&
    (summary.report?.plan?.approved === false ||
      summary.report?.qa?.verdict === "needs_repair")

  if (needsPlanReview) {
    return {
      label: "Needs review",
      detail: "QA complete",
      tone: "warning",
    }
  }

  if (summary.kind === "canonical") {
    return {
      label: "Approved",
      detail: "Ready for localized renders",
      tone: "success",
    }
  }

  return {
    label: "Completed",
    detail: summary.report?.output ? "Ready to preview" : "Ready for delivery",
    tone: "success",
  }
}

function getSmartCropProgressDisplay(
  job: JobRecord,
  summary: SmartCropJobSummary,
): SmartCropProgressDisplay {
  if (job.status === "failed") {
    return { label: "Failed", percent: 0, tone: "danger" }
  }

  if (job.status === "completed") {
    return { label: "Complete", percent: 100, tone: "success" }
  }

  const totalSteps = Math.max(job.steps.length, 1)
  const completedSteps = job.steps.filter(
    (step) => step.status === "completed" || step.status === "skipped",
  ).length
  const percent = Math.max(
    8,
    Math.min(96, Math.round((completedSteps / totalSteps) * 100)),
  )

  return { label: summary.phaseLabel, percent, tone: "running" }
}

function getSmartCropActionLabel(
  job: JobRecord,
  summary: SmartCropJobSummary,
  status: SmartCropStatusDisplay,
): string {
  if (job.status === "failed") return "View details"
  if (job.status === "pending" || job.status === "running")
    return "View progress"
  if (status.label === "Needs review") return "Review plan"
  if (summary.kind === "canonical") return "Preview"
  return "View output"
}

function getSmartCropActivityActor(
  job: JobRecord,
  summary: SmartCropJobSummary,
): string {
  if (job.status === "pending" || job.status === "running") return "System"
  if (summary.kind === "localized") return "System"
  return "Manager"
}

function SmartCropJobThumb({ job }: { job: JobRecord }) {
  const imageUrl = getSmartCropThumbnailUrl(job)
  const [canShowImage, setCanShowImage] = useState(Boolean(imageUrl))

  useEffect(() => {
    setCanShowImage(Boolean(imageUrl))
  }, [imageUrl])

  if (canShowImage && imageUrl) {
    return (
      // Mux thumbnail URLs are external runtime media, so img is intentional here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="smart-crop-job-thumb"
        src={imageUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setCanShowImage(false)}
      />
    )
  }

  return (
    <span
      className="smart-crop-job-thumb smart-crop-job-thumb-placeholder"
      aria-hidden="true"
    >
      <Film className="icon" aria-hidden="true" />
    </span>
  )
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

function SmartCropVideoThumb({ imageUrl }: { imageUrl: string | null }) {
  const [canShowImage, setCanShowImage] = useState(Boolean(imageUrl))

  useEffect(() => {
    setCanShowImage(Boolean(imageUrl))
  }, [imageUrl])

  if (canShowImage && imageUrl) {
    return (
      // Keep admin-sourced URLs in an img src, not CSS.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="smart-crop-picker-thumb"
        src={imageUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setCanShowImage(false)}
      />
    )
  }

  return (
    <span className="smart-crop-picker-thumb" aria-hidden="true">
      <Film className="icon" aria-hidden="true" />
    </span>
  )
}

function SmartCropVideoPickerModal({
  videos,
  loadFailed,
  query,
  filteredVideos,
  resolvingId,
  rowIssues,
  onClose,
  onQueryChange,
  onResolve,
}: {
  videos: VideoPickerItem[] | null
  loadFailed: boolean
  query: string
  filteredVideos: VideoPickerItem[]
  resolvingId: string | null
  rowIssues: Record<string, string>
  onClose: () => void
  onQueryChange: (query: string) => void
  onResolve: (video: VideoPickerItem) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmedQuery = query.trim()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      className="smart-crop-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="smart-crop-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-crop-picker-title"
      >
        <header className="smart-crop-picker-modal-header">
          <div>
            <p className="studio-page-eyebrow">Source video</p>
            <h3
              id="smart-crop-picker-title"
              className="smart-crop-picker-modal-title"
            >
              Search by title or slug
            </h3>
          </div>
          <button
            type="button"
            className="smart-crop-picker-close"
            aria-label="Close video search"
            title="Close video search"
            onClick={onClose}
          >
            <X className="icon" aria-hidden="true" />
          </button>
        </header>

        <div className="smart-crop-picker-search-panel">
          <label className="smart-crop-picker-search-field">
            <Search className="icon" aria-hidden="true" />
            <span className="sr-only">Search videos by title or slug</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Type a title or slug"
            />
          </label>
        </div>

        <div className="smart-crop-picker-modal-body">
          {loadFailed ? (
            <div className="smart-crop-picker-empty" role="status">
              <Film className="icon" aria-hidden="true" />
              <p>Video library did not load.</p>
            </div>
          ) : trimmedQuery.length === 0 ? (
            <div className="smart-crop-picker-empty" role="status">
              <Search className="icon" aria-hidden="true" />
              <p>Start typing to find a source video.</p>
            </div>
          ) : videos === null ? (
            <div className="smart-crop-picker-empty" role="status">
              <RefreshCw className="icon is-spinning" aria-hidden="true" />
              <p>Loading video library...</p>
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="smart-crop-picker-empty" role="status">
              <Film className="icon" aria-hidden="true" />
              <p>No videos match {trimmedQuery}.</p>
            </div>
          ) : (
            <div
              className="smart-crop-picker-list"
              role="list"
              aria-label="Video search results"
            >
              {filteredVideos.map((video) => {
                const issue = rowIssues[video.id]
                const isResolving = resolvingId === video.id
                return (
                  <button
                    type="button"
                    key={video.id}
                    className={`smart-crop-picker-result${issue ? " has-issue" : ""}`}
                    disabled={resolvingId !== null}
                    onClick={() => onResolve(video)}
                  >
                    <SmartCropVideoThumb imageUrl={video.imageUrl} />
                    <span className="smart-crop-picker-result-main">
                      <span className="smart-crop-picker-result-title">
                        {video.title}
                      </span>
                      <span className="smart-crop-picker-result-meta">
                        {video.slug ?? "No slug"} /{" "}
                        {video.coreId ?? "No Core ID"}
                      </span>
                    </span>
                    <span className="smart-crop-picker-result-side">
                      <span className="jobs-language-badge">{video.label}</span>
                      {isResolving ? (
                        <RefreshCw
                          className="icon is-spinning"
                          aria-hidden="true"
                        />
                      ) : issue ? (
                        <span className="jobs-error-text small">{issue}</span>
                      ) : (
                        <ArrowRight className="icon" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function CanonicalJobForm({
  formId,
  onCreated,
  variant = "standalone",
}: {
  formId?: string
  onCreated: () => void
  variant?: "embedded" | "standalone"
}) {
  const [videos, setVideos] = useState<VideoPickerItem[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [query, setQuery] = useState("")
  const [isPickerOpen, setIsPickerOpen] = useState(false)
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
  const modalRoot = typeof document === "undefined" ? null : document.body
  const isEmbedded = variant === "embedded"
  const openPicker = useCallback(() => {
    setIsPickerOpen(true)
  }, [])

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

  useEffect(() => {
    if (!isPickerOpen) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsPickerOpen(false)
    }

    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [isPickerOpen])

  useEffect(() => {
    document.body.classList.toggle("studio-modal-open", isPickerOpen)
    return () => {
      document.body.classList.remove("studio-modal-open")
    }
  }, [isPickerOpen])

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
      setIsPickerOpen(false)
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
    <form
      id={formId}
      onSubmit={onSubmit}
      className={
        isEmbedded
          ? "jobs-form smart-crop-create-form"
          : "collection-card jobs-card jobs-form"
      }
    >
      {!isEmbedded ? (
        <div className="jobs-card-header">
          <h2 className="jobs-card-title">Canonical crop plan</h2>
        </div>
      ) : null}
      <div className="jobs-field smart-crop-video-select-field">
        <div className="small jobs-field-label">Source video</div>
        <button
          type="button"
          className={`smart-crop-video-select${selectedVideo ? " is-selected" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={isPickerOpen}
          onPointerDown={(event) => {
            event.preventDefault()
            openPicker()
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              openPicker()
            }
          }}
          onClick={openPicker}
        >
          <span className="smart-crop-video-select-icon" aria-hidden="true">
            {selectedVideo ? (
              <Check className="icon" aria-hidden="true" />
            ) : (
              <Search className="icon" aria-hidden="true" />
            )}
          </span>
          <span className="smart-crop-video-select-copy">
            <span className="smart-crop-video-select-title">
              {selectedVideo?.title ?? "Search by title or slug"}
            </span>
            <span className="smart-crop-video-select-meta">
              {selectedVideo
                ? `${selectedVideo.slug ?? selectedVideo.coreId} / ${selectedVideo.muxAssetId}`
                : "Choose a source video from the Manager library"}
            </span>
          </span>
        </button>
        {loadFailed ? (
          <p className="jobs-error-text">Could not load the video library.</p>
        ) : null}
      </div>

      {modalRoot && isPickerOpen
        ? createPortal(
            <SmartCropVideoPickerModal
              videos={videos}
              loadFailed={loadFailed}
              query={query}
              filteredVideos={filteredVideos}
              resolvingId={resolvingId}
              rowIssues={rowIssues}
              onClose={() => setIsPickerOpen(false)}
              onQueryChange={setQuery}
              onResolve={(video) => void resolveVideo(video)}
            />,
            modalRoot,
          )
        : null}

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
          {isSubmitting ? "Creating..." : "Create master crop plan"}
        </button>
      </div>
      <FormStatus status={status} />
    </form>
  )
}

function LocalizedJobForm({
  formId,
  onCreated,
  variant = "standalone",
}: {
  formId?: string
  onCreated: () => void
  variant?: "embedded" | "standalone"
}) {
  const [muxAssetId, setMuxAssetId] = useState("")
  const [assetId, setAssetId] = useState("")
  const [canonicalAssetId, setCanonicalAssetId] = useState("")
  const [language, setLanguage] = useState("")
  const [cropMode, setCropMode] = useState<SmartCropCropMode>("auto")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<RequestStatus>({ type: "idle" })
  const isEmbedded = variant === "embedded"

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
    <form
      id={formId}
      onSubmit={onSubmit}
      className={
        isEmbedded
          ? "jobs-form smart-crop-create-form"
          : "collection-card jobs-card jobs-form"
      }
    >
      {!isEmbedded ? (
        <div className="jobs-card-header">
          <h2 className="jobs-card-title">Localized 9:16 output</h2>
        </div>
      ) : null}
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
          {isSubmitting ? "Creating..." : "Render localized version"}
        </button>
      </div>
      <FormStatus status={status} />
    </form>
  )
}

export function SmartCropScreen({ initialJobs }: SmartCropScreenProps) {
  const [jobs, setJobs] = useState<JobRecord[]>(initialJobs)
  const [activityNow, setActivityNow] = useState<number | null>(null)

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

  useEffect(() => {
    const updateActivityNow = () => setActivityNow(Date.now())
    const timeoutId = window.setTimeout(updateActivityNow, 0)
    const intervalId = window.setInterval(updateActivityNow, 60_000)
    return () => {
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <>
      <header className="studio-page-intro studio-page-intro--with-actions smart-crop-hero">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Media generation</span>
          <h1>Smart Crop</h1>
          <p>
            Create master crop plans and render localized 9:16 vertical videos.{" "}
            <button
              type="button"
              className="smart-crop-learn-more"
              disabled
              title="Documentation link is not wired in this build"
            >
              Learn more
              <ExternalLink className="icon" aria-hidden="true" />
            </button>
          </p>
        </div>
        <div className="studio-page-intro-actions smart-crop-hero-actions">
          <a
            href="#smart-crop-canonical-card"
            className="smart-crop-action-button smart-crop-action-button-secondary"
          >
            <Crop className="icon" aria-hidden="true" />
            New master crop plan
          </a>
          <a
            href="#smart-crop-localized-card"
            className="smart-crop-action-button smart-crop-action-button-primary"
          >
            <Sparkles className="icon" aria-hidden="true" />
            Render localized version
          </a>
        </div>
      </header>

      <section className="smart-crop-console-card">
        <div className="smart-crop-console-header">
          <div>
            <h2 className="smart-crop-console-title">Smart Crop jobs</h2>
            <p className="smart-crop-console-kicker">
              Plans, localized renders, QA state, and delivery readiness.
            </p>
          </div>
          <button
            type="button"
            className="smart-crop-refresh-button"
            onClick={() => void refresh()}
          >
            <RefreshCw className="icon" aria-hidden="true" />
            Refresh
          </button>
        </div>

        <div
          className="smart-crop-filter-bar"
          aria-label="Smart Crop job filters"
        >
          <label className="smart-crop-filter-control smart-crop-filter-search">
            <Search className="icon" aria-hidden="true" />
            <span className="sr-only">Search Smart Crop jobs</span>
            <input
              disabled
              placeholder="Search videos..."
              title="Search is not available yet"
            />
          </label>
          <button
            type="button"
            className="smart-crop-filter-control smart-crop-filter-button"
            disabled
            title="Type filtering is not available yet"
          >
            <SlidersHorizontal className="icon" aria-hidden="true" />
            Type: All
            <ChevronDown className="icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="smart-crop-filter-control smart-crop-filter-button"
            disabled
            title="Status filtering is not available yet"
          >
            Status: All
            <ChevronDown className="icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="smart-crop-filter-control smart-crop-filter-button"
            disabled
            title="Language filtering is not available yet"
          >
            Language: All
            <ChevronDown className="icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="smart-crop-filter-control smart-crop-filter-button"
            disabled
            title="Date filtering is not available yet"
          >
            Date range
            <Calendar className="icon" aria-hidden="true" />
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="smart-crop-empty-state" role="status">
            <Film className="icon" aria-hidden="true" />
            <p>No smart-crop jobs yet. Create a master crop plan to start.</p>
          </div>
        ) : (
          <div className="jobs-table-wrap smart-crop-jobs-table-wrap">
            <table className="table jobs-table smart-crop-jobs-table">
              <colgroup>
                <col className="smart-crop-jobs-col-video" />
                <col className="smart-crop-jobs-col-type" />
                <col className="smart-crop-jobs-col-status" />
                <col className="smart-crop-jobs-col-progress" />
                <col className="smart-crop-jobs-col-language" />
                <col className="smart-crop-jobs-col-activity" />
                <col className="smart-crop-jobs-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Language</th>
                  <th>Last activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const summary = getSmartCropJobSummary(job)
                  if (!summary) return null
                  const sourceTitle = getSmartCropSourceTitle(job)
                  const status = getSmartCropStatusDisplay(job, summary)
                  const progress = getSmartCropProgressDisplay(job, summary)
                  const actionLabel = getSmartCropActionLabel(
                    job,
                    summary,
                    status,
                  )
                  return (
                    <tr key={job.id}>
                      <td>
                        <div className="smart-crop-video-cell">
                          <SmartCropJobThumb job={job} />
                          <span className="smart-crop-video-copy">
                            <Link
                              href={`/dashboard/smart-crop/${job.id}`}
                              className="smart-crop-video-title"
                            >
                              {sourceTitle}
                            </Link>
                            <span
                              className="smart-crop-video-meta"
                              title={getSmartCropRowSubtitle(job, summary)}
                            >
                              {getSmartCropRowSubtitle(job, summary)}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`smart-crop-type-pill smart-crop-type-pill-${summary.kind}`}
                        >
                          {summary.kind === "canonical"
                            ? "Master plan"
                            : "Localized render"}
                        </span>
                      </td>
                      <td>
                        <span className="smart-crop-status-stack">
                          <span
                            className={`smart-crop-status-badge smart-crop-status-badge-${status.tone}`}
                          >
                            {status.label}
                          </span>
                          <span className="smart-crop-status-detail">
                            <span
                              className={`smart-crop-status-dot smart-crop-status-dot-${status.tone}`}
                              aria-hidden="true"
                            />
                            {status.detail}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="smart-crop-progress">
                          <span className="smart-crop-progress-label">
                            {progress.label}
                          </span>
                          <span
                            className="smart-crop-progress-meter"
                            aria-hidden="true"
                          >
                            <span
                              className={`smart-crop-progress-fill smart-crop-progress-fill-${progress.tone}`}
                              style={{ width: `${progress.percent}%` }}
                            />
                          </span>
                          <span className="smart-crop-progress-percent">
                            {progress.percent}%
                          </span>
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            summary.language
                              ? "smart-crop-language"
                              : "smart-crop-language smart-crop-language-empty"
                          }
                        >
                          {summary.language?.toUpperCase() ?? "—"}
                        </span>
                      </td>
                      <td>
                        <span className="smart-crop-activity">
                          <span>
                            {formatRelativeActivity(job.updatedAt, activityNow)}
                          </span>
                          <span>{getSmartCropActivityActor(job, summary)}</span>
                        </span>
                      </td>
                      <td>
                        <span className="smart-crop-actions-cell">
                          <Link
                            href={`/dashboard/smart-crop/${job.id}`}
                            className="smart-crop-row-action"
                          >
                            {actionLabel}
                          </Link>
                          <button
                            type="button"
                            className="smart-crop-row-menu"
                            disabled
                            title="More actions are not available yet"
                            aria-label="More actions unavailable"
                          >
                            <MoreVertical className="icon" aria-hidden="true" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div
          className="smart-crop-table-footer"
          aria-label="Smart Crop pagination"
        >
          <span>
            Showing {jobs.length === 0 ? 0 : 1}-{jobs.length} of {jobs.length}{" "}
            jobs
          </span>
          <div className="smart-crop-pagination" aria-hidden="true">
            <button type="button" className="smart-crop-page-button" disabled>
              ‹
            </button>
            <button
              type="button"
              className="smart-crop-page-button is-current"
              disabled
            >
              1
            </button>
            <button type="button" className="smart-crop-page-button" disabled>
              2
            </button>
            <button type="button" className="smart-crop-page-button" disabled>
              …
            </button>
            <button type="button" className="smart-crop-page-button" disabled>
              ›
            </button>
          </div>
        </div>
      </section>

      <section
        className="smart-crop-create-section"
        aria-labelledby="smart-crop-create-title"
      >
        <div className="smart-crop-create-heading">
          <h2 id="smart-crop-create-title">Create new job</h2>
        </div>
        <div className="smart-crop-create-grid">
          <article
            id="smart-crop-canonical-card"
            className="smart-crop-create-card smart-crop-create-card-canonical"
          >
            <div className="smart-crop-create-card-header">
              <span className="smart-crop-create-icon" aria-hidden="true">
                <Crop className="icon" />
              </span>
              <div>
                <h3>1. Master Crop Plan</h3>
                <p>Analyze a source video and create an AI crop plan.</p>
              </div>
            </div>
            <ul className="smart-crop-create-list">
              <li>
                <Check className="icon" aria-hidden="true" />
                Detect shots and key moments
              </li>
              <li>
                <Check className="icon" aria-hidden="true" />
                Define optimal 9:16 framing
              </li>
            </ul>
            <CanonicalJobForm
              formId="smart-crop-canonical-form"
              variant="embedded"
              onCreated={() => void refresh()}
            />
          </article>

          <article
            id="smart-crop-localized-card"
            className="smart-crop-create-card smart-crop-create-card-localized"
          >
            <div className="smart-crop-create-card-header">
              <span className="smart-crop-create-icon" aria-hidden="true">
                <Sparkles className="icon" />
              </span>
              <div>
                <h3>2. Localized Render</h3>
                <p>Render a localized 9:16 video using an approved plan.</p>
              </div>
            </div>
            <ul className="smart-crop-create-list">
              <li>
                <Check className="icon" aria-hidden="true" />
                Reuse approved crop plan
              </li>
              <li>
                <Check className="icon" aria-hidden="true" />
                Generate localized vertical video
              </li>
            </ul>
            <LocalizedJobForm
              formId="smart-crop-localized-form"
              variant="embedded"
              onCreated={() => void refresh()}
            />
          </article>
        </div>
        <details className="smart-crop-advanced-settings">
          <summary>
            <LockKeyhole className="icon" aria-hidden="true" />
            Advanced settings
            <span>(Mux IDs, asset IDs, playback options)</span>
            <ChevronDown
              className="icon smart-crop-advanced-chevron"
              aria-hidden="true"
            />
          </summary>
          <p>
            Advanced inputs are available inside each job form. Additional batch
            settings are intentionally disabled until the workflow supports
            them.
          </p>
        </details>
      </section>
    </>
  )
}
