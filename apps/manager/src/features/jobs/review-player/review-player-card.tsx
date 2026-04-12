"use client"

import "video.js/dist/video-js.css"
import React, { useMemo, useState } from "react"
import {
  useVideoPlayerCore,
  type VideoPlayerTextTrack,
} from "@forge/video-player"
import {
  Captions,
  Expand,
  FileJson2,
  ListOrdered,
  LoaderCircle,
  Network,
  Pause,
  Play,
  Shrink,
  Volume2,
  VolumeX,
} from "lucide-react"
import { buildReviewPlayerState } from "./review-player-presenter"
import {
  buildReviewMetadataFields,
  type ReviewMetadataDisplayField,
} from "./review-player-metadata"
import type {
  JobReviewContextResult,
  ReviewMode,
  ReviewPlayerReadyState,
} from "./review-player-types"
import type { JobRecord } from "@/types/job"

type ReviewContextLoadState =
  | {
      status: "loading"
    }
  | JobReviewContextResult

type ReviewPlayerCardProps = {
  job: JobRecord
  reviewContext: ReviewContextLoadState
}

function formatChapterTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function AvailabilityMessage({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div className="jobs-review-empty-state">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  )
}

function ReviewPanel({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="jobs-review-panel">
      <header className="jobs-review-panel-header">
        <span className="jobs-review-panel-icon" aria-hidden="true">
          {icon}
        </span>
        <h4>{title}</h4>
      </header>
      {children}
    </section>
  )
}

function MetadataField({ field }: { field: ReviewMetadataDisplayField }) {
  return (
    <div className="jobs-review-copy-block">
      <div className="small">{field.label}</div>
      {field.kind === "text" ? (
        <p>{field.value ?? "–"}</p>
      ) : field.values.length > 0 ? (
        <div className="jobs-review-chip-row">
          {field.values.map((value, index) => (
            <span
              key={`${field.label}-${value}-${index}`}
              className="jobs-review-chip"
            >
              {value}
            </span>
          ))}
        </div>
      ) : (
        <p>–</p>
      )}
    </div>
  )
}

function ReviewVideoPlayer({ state }: { state: ReviewPlayerReadyState }) {
  const textTracks = useMemo<VideoPlayerTextTrack[]>(
    () =>
      state.player.track
        ? [
            {
              src: state.player.track.src,
              label: state.player.track.label,
              languageCode: state.player.track.languageCode,
              kind: "subtitles",
              isDefault: true,
            },
          ]
        : [],
    [state.player.track],
  )
  const {
    containerRef,
    videoRef,
    sliderRef,
    timeRef,
    isMuted,
    isPlaying,
    isFullscreen,
    handlePlayPause,
    handleMuteToggle,
    handleSeek,
    handleFullscreen,
  } = useVideoPlayerCore({
    src: state.player.src,
    textTracks,
  })

  return (
    <div className="jobs-review-video" ref={containerRef}>
      <div className="jobs-review-video-stage">
        <div
          role="button"
          tabIndex={0}
          className="jobs-review-video-hitbox"
          onClick={handlePlayPause}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              handlePlayPause()
            }
          }}
          aria-label={isPlaying ? "Pause review video" : "Play review video"}
        >
          <video
            className="video-js vjs-fluid vjs-default-skin jobs-review-video-element"
            ref={videoRef}
            playsInline
          />
        </div>

        {!isMuted ? (
          <button
            type="button"
            className="jobs-review-video-surface-button is-left"
            onClick={handleMuteToggle}
            aria-label="Mute review video"
          >
            <Volume2 size={18} aria-hidden="true" />
          </button>
        ) : null}

        <button
          type="button"
          className="jobs-review-video-surface-button is-right"
          onClick={handleFullscreen}
          aria-label={
            isFullscreen
              ? "Exit review video fullscreen"
              : "Enter review video fullscreen"
          }
        >
          {isFullscreen ? (
            <Shrink size={18} aria-hidden="true" />
          ) : (
            <Expand size={18} aria-hidden="true" />
          )}
        </button>

        {isMuted ? (
          <button
            type="button"
            className="jobs-review-video-surface-button jobs-review-video-mute-overlay"
            onClick={handleMuteToggle}
            aria-label="Unmute review video"
          >
            <VolumeX size={26} aria-hidden="true" />
          </button>
        ) : null}

        <div className="jobs-review-video-controls">
          <button
            type="button"
            className="jobs-review-video-control"
            onClick={handlePlayPause}
            aria-label={isPlaying ? "Pause review video" : "Play review video"}
          >
            {isPlaying ? (
              <Pause size={20} aria-hidden="true" />
            ) : (
              <Play size={20} aria-hidden="true" />
            )}
          </button>

          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={100}
            defaultValue={0}
            step="any"
            onChange={handleSeek}
            className="jobs-review-video-progress"
            aria-label="Review video progress"
          />

          <span ref={timeRef} className="jobs-review-video-time">
            0:00 / 0:00
          </span>
        </div>
      </div>
    </div>
  )
}

export function ReviewPlayerCard({
  job,
  reviewContext,
}: ReviewPlayerCardProps) {
  const [mode, setMode] = useState<ReviewMode>("after")
  const [language, setLanguage] = useState<string | undefined>(undefined)

  const state = useMemo(() => {
    if (reviewContext.status === "loading") {
      return null
    }

    return buildReviewPlayerState({
      job,
      reviewContext,
      selection: {
        mode,
        language,
      },
    })
  }, [job, language, mode, reviewContext])

  return (
    <section className="collection-card jobs-card jobs-review-card">
      <div className="jobs-card-header">
        <div className="jobs-step-header-group">
          <Captions size={18} aria-hidden="true" />
          <div>
            <h3 className="jobs-section-title">Review Player</h3>
            <p className="jobs-review-summary">
              Inspect generated enrichment outputs against the current live
              state.
            </p>
          </div>
        </div>
      </div>

      {reviewContext.status === "loading" ? (
        <div className="jobs-review-loading">
          <LoaderCircle
            className="jobs-spin-icon"
            size={18}
            aria-hidden="true"
          />
          <span>Loading review context…</span>
        </div>
      ) : state?.status === "failed" || state?.status === "unsupported" ? (
        <AvailabilityMessage
          title={
            state.status === "failed"
              ? "Review context failed"
              : "Review context unavailable"
          }
          message={state.message}
        />
      ) : state ? (
        <>
          <div className="jobs-review-toolbar">
            <div
              className="jobs-review-tabs"
              role="group"
              aria-label="Review mode"
            >
              {(["before", "after"] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  type="button"
                  aria-pressed={state.mode === nextMode}
                  className={`jobs-review-tab ${state.mode === nextMode ? "is-active" : ""}`}
                  onClick={() => setMode(nextMode)}
                >
                  {nextMode === "after" ? "After" : "Before"}
                </button>
              ))}
            </div>

            {state.languages.length > 0 ? (
              <label className="jobs-review-language">
                <span className="small">Language</span>
                <select
                  className="jobs-review-select"
                  value={state.language ?? ""}
                  onChange={(event) =>
                    setLanguage(event.target.value || undefined)
                  }
                >
                  {state.languages.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="jobs-review-player-shell">
            <div className="jobs-review-player-meta">
              <span className="jobs-review-player-pill">
                {state.mode === "after" ? "Generated output" : "Live state"}
              </span>
              {state.player.track ? (
                <span className="jobs-review-player-pill jobs-review-player-pill-muted">
                  {state.player.track.label} subtitles
                </span>
              ) : null}
            </div>
            <ReviewVideoPlayer state={state} />
            {state.player.track == null && state.player.emptyMessage ? (
              <p className="jobs-review-player-note">
                {state.player.emptyMessage}
              </p>
            ) : null}
          </div>

          <div className="jobs-review-grid">
            <ReviewPanel title="Metadata" icon={<FileJson2 size={16} />}>
              {state.metadata.status === "available" ? (
                <div className="jobs-review-copy">
                  {buildReviewMetadataFields({
                    job,
                    metadata: state.metadata.value,
                  }).map((field) => (
                    <MetadataField key={field.label} field={field} />
                  ))}
                </div>
              ) : state.metadata.status === "failed" ? (
                <AvailabilityMessage
                  title="Metadata unavailable"
                  message={state.metadata.message}
                />
              ) : (
                <AvailabilityMessage
                  title="Metadata unavailable"
                  message={state.metadata.reason.replaceAll("_", " ")}
                />
              )}
            </ReviewPanel>

            <ReviewPanel title="Chapters" icon={<ListOrdered size={16} />}>
              {state.chapters.status === "available" ? (
                state.chapters.value.chapters.length > 0 ? (
                  <ol className="jobs-review-chapters">
                    {state.chapters.value.chapters.map((chapter, index) => (
                      <li key={`${chapter.title}-${index}`}>
                        <div className="jobs-review-chapter-heading">
                          <strong>{chapter.title}</strong>
                          <span>{formatChapterTime(chapter.startSeconds)}</span>
                        </div>
                        {chapter.summary ? <p>{chapter.summary}</p> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <AvailabilityMessage
                    title="No chapters"
                    message="This review state has no chapter outline yet."
                  />
                )
              ) : state.chapters.status === "failed" ? (
                <AvailabilityMessage
                  title="Chapters unavailable"
                  message={state.chapters.message}
                />
              ) : (
                <AvailabilityMessage
                  title="Chapters unavailable"
                  message={state.chapters.reason.replaceAll("_", " ")}
                />
              )}
            </ReviewPanel>
          </div>

          <ReviewPanel title="Compare status" icon={<Network size={16} />}>
            <div className="jobs-review-status-list">
              <div>
                <div className="small">Mux subtitles</div>
                <p>
                  {state.compare.muxSyncComparison?.status ?? "not compared"}
                </p>
              </div>
              <div>
                <div className="small">Transcript embeddings</div>
                <p>{state.compare.embeddingSync?.status ?? "not reported"}</p>
              </div>
              <div>
                <div className="small">Scene embeddings</div>
                <p>
                  {state.compare.sceneEmbeddingSync?.status ?? "not reported"}
                </p>
              </div>
            </div>
          </ReviewPanel>
        </>
      ) : null}
    </section>
  )
}
