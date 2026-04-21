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
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  SegmentedControl,
  SegmentedControlButton,
} from "@/components/ui/segmented-control"
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

const panelClassName =
  "rounded-[22px] border border-border/80 bg-secondary/30 p-6"

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
    <div className="rounded-[20px] border border-dashed border-border/80 bg-card/70 px-5 py-4">
      <strong className="block text-sm font-semibold text-foreground">
        {title}
      </strong>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
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
    <section className={panelClassName}>
      <header className="mb-5 flex items-center gap-3">
        <span
          className="flex size-10 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground shadow-[0_1px_2px_rgba(8,8,8,0.04)]"
          aria-hidden="true"
        >
          {icon}
        </span>
        <h4 className="text-base font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h4>
      </header>
      {children}
    </section>
  )
}

function MetadataField({ field }: { field: ReviewMetadataDisplayField }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {field.label}
      </div>
      {field.kind === "text" ? (
        <p className="text-[15px] leading-7 text-foreground">
          {field.value ?? "–"}
        </p>
      ) : field.values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {field.values.map((value, index) => (
            <Badge
              key={`${field.label}-${value}-${index}`}
              variant="neutral"
              className="font-normal tracking-[0]"
            >
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-[15px] leading-7 text-foreground">–</p>
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
    <div ref={containerRef}>
      <div className="overflow-hidden rounded-[22px] border border-border bg-black shadow-[0_14px_34px_rgba(8,8,8,0.08)]">
        <video
          className="video-js vjs-fluid vjs-default-skin min-h-[240px] w-full bg-black"
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
    <Card id="review-player">
      <CardHeader className="gap-4 border-b border-border/70 pb-6">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-secondary text-muted-foreground shadow-[0_1px_2px_rgba(8,8,8,0.04)]">
            <Captions size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-[22px] font-semibold tracking-[-0.03em] text-foreground">
              Review Player
            </h3>
            <p className="mt-2 max-w-3xl text-[15px] leading-7 text-muted-foreground">
              Inspect generated enrichment outputs against the current live
              state.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-8 pt-8">
        {reviewContext.status === "loading" ? (
          <div className="flex items-center gap-3 rounded-[20px] border border-border/80 bg-secondary/30 px-5 py-4 text-sm text-muted-foreground">
            <LoaderCircle
              className="size-4 animate-spin"
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
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <SegmentedControl
                className="w-full md:w-auto"
                role="group"
                aria-label="Review mode"
              >
                {(["before", "after"] as const).map((nextMode) => (
                  <SegmentedControlButton
                    key={nextMode}
                    type="button"
                    active={state.mode === nextMode}
                    className="flex-1 md:flex-none"
                    onClick={() => setMode(nextMode)}
                  >
                    {nextMode === "after" ? "After" : "Before"}
                  </SegmentedControlButton>
                ))}
              </SegmentedControl>

              {state.languages.length > 0 ? (
                <label className="flex min-w-[200px] flex-col gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Language
                  </span>
                  <select
                    className="h-11 w-full cursor-pointer rounded-2xl border border-border bg-card px-4 text-[15px] text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.04)] outline-none transition-[border-color,box-shadow] focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-black/10"
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

            <div className="space-y-3">
              <ReviewVideoPlayer state={state} />
              {state.player.track == null && state.player.emptyMessage ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  {state.player.emptyMessage}
                </p>
              ) : null}
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <ReviewPanel title="Metadata" icon={<FileJson2 size={16} />}>
                {state.metadata.status === "available" ? (
                  <div className="space-y-5">
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
                    <ol className="space-y-4">
                      {state.chapters.value.chapters.map((chapter, index) => (
                        <li
                          key={`${chapter.title}-${index}`}
                          className="rounded-[18px] border border-border/70 bg-card/70 px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <strong className="text-sm font-semibold text-foreground">
                              {chapter.title}
                            </strong>
                            <span className="shrink-0 text-xs font-medium text-muted-foreground">
                              {formatChapterTime(chapter.startSeconds)}
                            </span>
                          </div>
                          {chapter.summary ? (
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">
                              {chapter.summary}
                            </p>
                          ) : null}
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
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    label: "Mux subtitles",
                    value: state.compare.muxSyncComparison?.status,
                  },
                  {
                    label: "Transcript embeddings",
                    value: state.compare.embeddingSync?.status,
                  },
                  {
                    label: "Scene embeddings",
                    value: state.compare.sceneEmbeddingSync?.status,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[18px] border border-border/70 bg-card/70 px-4 py-3"
                  >
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {item.label}
                    </div>
                    <p className="mt-2 text-sm font-medium capitalize text-foreground">
                      {item.value ?? "not reported"}
                    </p>
                  </div>
                ))}
              </div>
            </ReviewPanel>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
