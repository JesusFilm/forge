"use client"

// Shorts Studio creation flow (plan 2026-06-11-002 "UI"):
//   Step A — picker over the existing /api/videos coverage read model with
//   client-side search and per-video eligibility resolution
//   (disabled-with-reason rows for missing Mux assets / signed playback).
//   Step B — video.js HLS scrubber with Set in / Set out capture, mm:ss
//   inputs, 5–180s guardrails mirroring the server reasons, optional title.
// Clone flow prefill arrives via searchParams (coreId/start/end).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type Player from "video.js/dist/types/player"
import { useVideoPlayerCore } from "@forge/video-player"
import { SHORT_CLIP_DURATION } from "@forge/shorts-compositions/schema"
import {
  ArrowLeft,
  CornerDownLeft,
  CornerDownRight,
  RefreshCw,
  Scissors,
  Search,
} from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
// Type-only import (erased at compile time) — the route module itself never
// enters the client bundle; its response type is the single source of truth.
import type { ShortsVideoResolution } from "@/app/api/shorts/videos/[coreId]/route"
import type { JobRecord } from "@/types/job"
import {
  formatClipInput,
  formatClipTime,
  parseClipTime,
  validateClipSelection,
} from "./shorts-presenter"
import {
  flattenPickerVideos,
  type PickerVideo,
  type VideosApiResponse,
} from "./shorts-picker"

const PICKER_RESULT_LIMIT = 60

type ResolvedShortsVideo = ShortsVideoResolution & {
  playbackId: string
  slug: string | null
}

export type ShortsCreatePrefill = {
  coreId?: string
  startSec?: number
  endSec?: number
}

function describeIneligibility(
  reason: ShortsVideoResolution["reason"],
): string {
  switch (reason) {
    case "missing_mux_asset":
      return "No Mux asset — this video cannot be clipped into a short."
    case "playback_not_public":
      return "Playback is signed/DRM-only — only public-playback videos can be clipped."
    default:
      return "This video is not eligible for shorts."
  }
}

// Friendly messages for the create route's 422/503 reasons (mirror of the
// server-side validation — the client validates the same bounds up front).
function describeCreateFailure(payload: {
  reason?: string
  error?: string
  messages?: string[]
}): string {
  switch (payload.reason) {
    case "clip_too_short":
      return `Shorts must be at least ${SHORT_CLIP_DURATION.minSec} seconds long.`
    case "clip_too_long":
      return `Shorts can be at most ${SHORT_CLIP_DURATION.maxSec} seconds long.`
    case "clip_out_of_bounds":
      return "The clip extends past the end of the source video."
    case "playback_not_public":
      return "Playback is signed/DRM-only — only public-playback videos can be clipped."
    case "missing_mux_asset":
      return "This video has no Mux asset — it cannot be clipped into a short."
    case "video_not_found":
      return "The selected video no longer exists."
    case "mux_error":
      return "Mux could not be reached to resolve the source video — this is usually transient, try again."
    case "config_missing":
      return `Shorts Studio is not configured on this deployment. ${(payload.messages ?? []).join(" ")}`
    default:
      return payload.error ?? "Failed to create the short."
  }
}

function ClipScrubber({
  resolution,
  prefill,
  onBack,
}: {
  resolution: ResolvedShortsVideo
  prefill: ShortsCreatePrefill
  onBack: () => void
}) {
  const router = useRouter()
  const playerRef = useRef<Player | null>(null)

  const initialStart = prefill.startSec ?? 0
  const initialEnd =
    prefill.endSec ??
    Math.min(initialStart + 30, resolution.durationSec ?? initialStart + 30)

  const [startSec, setStartSec] = useState<number>(initialStart)
  const [endSec, setEndSec] = useState<number>(initialEnd)
  const [startText, setStartText] = useState<string>(
    formatClipInput(initialStart),
  )
  const [endText, setEndText] = useState<string>(formatClipInput(initialEnd))
  const [title, setTitle] = useState<string>(
    resolution.title ? `${resolution.title} short` : "",
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { containerRef, videoRef } = useVideoPlayerCore({
    src: `https://stream.mux.com/${resolution.playbackId}.m3u8`,
    nativeControls: true,
    onPlayerReady: (player) => {
      playerRef.current = player
    },
  })

  const startValid = parseClipTime(startText) !== null
  const endValid = parseClipTime(endText) !== null
  const validation = validateClipSelection({
    startSec,
    endSec,
    durationSec: resolution.durationSec,
  })
  const clipDurationSec = endSec - startSec

  const captureFromPlayer = useCallback((which: "in" | "out") => {
    const current = playerRef.current?.currentTime()
    if (current == null || !Number.isFinite(current)) return
    const rounded = Math.round(current * 10) / 10
    if (which === "in") {
      setStartSec(rounded)
      setStartText(formatClipInput(rounded))
    } else {
      setEndSec(rounded)
      setEndText(formatClipInput(rounded))
    }
  }, [])

  const onTimeInput = useCallback((which: "in" | "out", value: string) => {
    if (which === "in") {
      setStartText(value)
      const parsed = parseClipTime(value)
      if (parsed !== null) setStartSec(parsed)
    } else {
      setEndText(value)
      const parsed = parseClipTime(value)
      if (parsed !== null) setEndSec(parsed)
    }
  }, [])

  const canSubmit = startValid && endValid && validation.ok && !isSubmitting

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!canSubmit) return
      setIsSubmitting(true)
      setSubmitError(null)

      try {
        const response = await apiFetch("/api/shorts/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coreId: resolution.coreId,
            ...(resolution.slug ? { sourceSlug: resolution.slug } : {}),
            clip: { startSec, endSec },
            ...(title.trim().length > 0 ? { title: title.trim() } : {}),
          }),
        })

        const payload = (await response.json().catch(() => ({}))) as {
          job?: JobRecord
          reason?: string
          error?: string
          messages?: string[]
        }

        if (response.status === 201 && payload.job?.id) {
          router.push(`/dashboard/shorts/${payload.job.id}`)
          return
        }

        setSubmitError(describeCreateFailure(payload))
      } catch {
        setSubmitError("Request failed — check your connection and retry.")
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      canSubmit,
      endSec,
      resolution.coreId,
      resolution.slug,
      router,
      startSec,
      title,
    ],
  )

  return (
    <form onSubmit={onSubmit} className="collection-card jobs-card jobs-form">
      <div className="jobs-card-header">
        <div className="jobs-step-header-group">
          <button
            type="button"
            className="jobs-step-artifact-link"
            onClick={onBack}
          >
            <ArrowLeft
              className="jobs-step-artifact-icon"
              aria-hidden="true"
              size={14}
            />
            <span className="jobs-step-artifact-label">Back to picker</span>
          </button>
          <h2 className="jobs-card-title">
            {resolution.title ?? resolution.coreId}
          </h2>
        </div>
        <span className="small">
          {resolution.durationSec !== null
            ? `Source duration ${formatClipTime(resolution.durationSec)}`
            : "Source duration unknown"}
        </span>
      </div>

      <div className="jobs-review-video" ref={containerRef}>
        <div className="jobs-review-video-stage">
          <video
            className="video-js vjs-fluid vjs-default-skin shorts-video-fill"
            ref={videoRef}
            playsInline
          />
        </div>
      </div>

      <div className="grid cols-2 jobs-form-grid">
        <label className="jobs-field">
          <div className="small jobs-field-label">In point (mm:ss)</div>
          <div className="shorts-time-input-row">
            <input
              value={startText}
              onChange={(e) => onTimeInput("in", e.target.value)}
              className="jobs-input"
              aria-invalid={!startValid}
              aria-label="Clip in point"
            />
            <button
              type="button"
              className="jobs-primary-button"
              onClick={() => captureFromPlayer("in")}
              title="Capture the current player time as the in point"
            >
              <CornerDownLeft className="icon" aria-hidden="true" />
              Set in
            </button>
          </div>
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">Out point (mm:ss)</div>
          <div className="shorts-time-input-row">
            <input
              value={endText}
              onChange={(e) => onTimeInput("out", e.target.value)}
              className="jobs-input"
              aria-invalid={!endValid}
              aria-label="Clip out point"
            />
            <button
              type="button"
              className="jobs-primary-button"
              onClick={() => captureFromPlayer("out")}
              title="Capture the current player time as the out point"
            >
              <CornerDownRight className="icon" aria-hidden="true" />
              Set out
            </button>
          </div>
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">Title (optional)</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="jobs-input"
            maxLength={200}
            placeholder="Shown in the shorts list"
          />
        </label>
        <div className="jobs-field">
          <div className="small jobs-field-label">Clip</div>
          <p className="small shorts-clip-summary">
            {formatClipTime(startSec)}–{formatClipTime(endSec)} ·{" "}
            {clipDurationSec > 0 ? clipDurationSec.toFixed(1) : "0.0"}s (allowed{" "}
            {SHORT_CLIP_DURATION.minSec}–{SHORT_CLIP_DURATION.maxSec}s)
          </p>
        </div>
      </div>

      {!startValid || !endValid ? (
        <p className="jobs-error-text">
          Times must look like mm:ss (e.g. 1:05 or 1:05.5).
        </p>
      ) : !validation.ok ? (
        <p className="jobs-error-text">{validation.message}</p>
      ) : null}

      {resolution.language.whisper === null ? (
        <p className="small jobs-empty-state">
          {resolution.language.bcp47
            ? `Language ${resolution.language.bcp47} is not supported by transcription — `
            : "The video's language is unknown — "}
          the short will render without captions.
        </p>
      ) : null}

      {submitError ? <p className="jobs-error-text">{submitError}</p> : null}

      <div className="jobs-actions">
        <button
          type="submit"
          disabled={!canSubmit}
          className="jobs-primary-button"
        >
          {isSubmitting ? (
            <RefreshCw className="icon is-spinning" aria-hidden="true" />
          ) : (
            <Scissors className="icon" aria-hidden="true" />
          )}
          {isSubmitting ? "Creating..." : "Create short"}
        </button>
      </div>
    </form>
  )
}

export function ShortsCreateScreen({
  prefill,
}: {
  prefill: ShortsCreatePrefill
}) {
  const [videos, setVideos] = useState<PickerVideo[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [query, setQuery] = useState("")
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [rowIssues, setRowIssues] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<ResolvedShortsVideo | null>(null)
  const prefillAttemptedRef = useRef(false)

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
        setVideos(flattenPickerVideos(payload))
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true)
      }
    })()
    return () => controller.abort()
  }, [])

  const resolveVideo = useCallback(
    async (coreId: string, slug?: string | null) => {
      setResolvingId(coreId)
      try {
        const response = await apiFetch(
          `/api/shorts/videos/${encodeURIComponent(coreId)}`,
          { cache: "no-store" },
        )
        const payload = (await response.json().catch(() => ({}))) as
          | ShortsVideoResolution
          | { error?: string; reason?: string }

        if (!response.ok) {
          const failure = payload as { error?: string; reason?: string }
          setRowIssues((current) => ({
            ...current,
            [coreId]:
              failure.error ??
              `Could not resolve this video (${failure.reason ?? response.status}).`,
          }))
          return
        }

        const resolution = payload as ShortsVideoResolution
        if (!resolution.eligible || resolution.playbackId === null) {
          setRowIssues((current) => ({
            ...current,
            [coreId]: describeIneligibility(resolution.reason),
          }))
          return
        }

        setSelected({
          ...resolution,
          playbackId: resolution.playbackId,
          slug: slug ?? null,
        })
      } catch {
        setRowIssues((current) => ({
          ...current,
          [coreId]: "Could not resolve this video — retry.",
        }))
      } finally {
        setResolvingId(null)
      }
    },
    [],
  )

  // Clone flow: resolve the prefilled coreId straight away (once).
  useEffect(() => {
    if (prefillAttemptedRef.current || !prefill.coreId) return
    prefillAttemptedRef.current = true
    void resolveVideo(prefill.coreId)
  }, [prefill.coreId, resolveVideo])

  const filtered = useMemo(() => {
    if (!videos) return []
    const needle = query.trim().toLowerCase()
    const matches =
      needle.length === 0
        ? videos
        : videos.filter(
            (video) =>
              video.title.toLowerCase().includes(needle) ||
              (video.slug ?? "").toLowerCase().includes(needle) ||
              video.id.toLowerCase().includes(needle),
          )
    return matches.slice(0, PICKER_RESULT_LIMIT)
  }, [query, videos])

  return (
    <>
      <header className="studio-page-intro">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Shorts Studio</span>
          <h1>Create a short</h1>
          <p>
            Pick a library video, then set in/out points for a{" "}
            {SHORT_CLIP_DURATION.minSec}–{SHORT_CLIP_DURATION.maxSec} second
            clip.
          </p>
        </div>
      </header>

      {selected ? (
        <ClipScrubber
          resolution={selected}
          prefill={prefill}
          onBack={() => setSelected(null)}
        />
      ) : (
        <section className="collection-card jobs-card">
          <div className="jobs-card-header">
            <h2 className="jobs-card-title">Pick a source video</h2>
          </div>

          <label className="jobs-field shorts-picker-search">
            <div className="small jobs-field-label">
              <Search
                size={12}
                aria-hidden="true"
                className="shorts-picker-search-icon"
              />{" "}
              Search
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="jobs-input"
              placeholder="Title, slug, or core ID"
              autoFocus
            />
          </label>

          {loadFailed ? (
            <p className="jobs-error-text">
              Could not load the video library — reload the page to retry.
            </p>
          ) : videos === null ? (
            <p className="small jobs-empty-state">Loading video library…</p>
          ) : filtered.length === 0 ? (
            <p className="small jobs-empty-state">
              No videos match “{query.trim()}”.
            </p>
          ) : (
            <div className="jobs-table-wrap">
              <table className="table jobs-table">
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Type</th>
                    <th>Core ID</th>
                    <th aria-label="Eligibility" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((video) => {
                    const issue = rowIssues[video.id]
                    const isResolving = resolvingId === video.id
                    return (
                      <tr
                        key={video.id}
                        className={
                          issue ? "shorts-picker-row-ineligible" : undefined
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="jobs-step-artifact-link shorts-picker-video-button"
                            disabled={issue != null || resolvingId !== null}
                            onClick={() =>
                              void resolveVideo(video.id, video.slug)
                            }
                            title={issue ?? `Select ${video.title}`}
                          >
                            {video.imageUrl ? (
                              // An <img> keeps the admin-sourced URL out of
                              // CSS string interpolation (no url() injection
                              // surface). Raw <img> matches the coverage
                              // screen's thumbnail precedent.
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                className="shorts-picker-thumb"
                                src={video.imageUrl}
                                alt=""
                                aria-hidden="true"
                                loading="lazy"
                              />
                            ) : (
                              <span
                                className="shorts-picker-thumb"
                                aria-hidden="true"
                              />
                            )}
                            <span className="jobs-step-artifact-label">
                              {video.title}
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="jobs-language-badge">
                            {video.label}
                          </span>
                        </td>
                        <td>{video.id}</td>
                        <td>
                          {isResolving ? (
                            <RefreshCw
                              className="icon is-spinning"
                              aria-hidden="true"
                              size={14}
                            />
                          ) : issue ? (
                            <span className="jobs-error-text small">
                              {issue}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  )
}
