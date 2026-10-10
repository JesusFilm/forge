"use client"

import React, { useMemo, useState } from "react"
import {
  useVideoPlayerCore,
  type VideoPlayerTextTrack,
} from "@forge/video-player"
import {
  Captions,
  FileJson2,
  ListOrdered,
  LoaderCircle,
  Network,
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
    () => [
      ...(state.player.track
        ? [
            {
              src: state.player.track.src,
              label: state.player.track.label,
              languageCode: state.player.track.languageCode,
              kind: "subtitles" as const,
              isDefault: true,
            },
          ]
        : []),
      ...(state.player.chapterTrack
        ? [
            {
              src: state.player.chapterTrack.src,
              label: state.player.chapterTrack.label,
              languageCode: state.player.chapterTrack.languageCode,
              kind: "chapters" as const,
              isDefault: true,
            },
          ]
        : []),
    ],
    [state.player.chapterTrack, state.player.track],
  )
  const { containerRef, videoRef } = useVideoPlayerCore({
    src: state.player.src,
    textTracks,
    nativeControls: true,
  })

  return (
    <div className="jobs-review-video" ref={containerRef}>
      <div className="jobs-review-video-stage">
        <video
          className="video-js vjs-fluid vjs-default-skin jobs-review-video-element"
          ref={videoRef}
          playsInline
        />
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
            </div>
          </ReviewPanel>
        </>
      ) : null}
    </section>
  )
}
