"use client"

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { useVideoPlayerCore } from "@forge/video-player"
import type Player from "video.js/dist/types/player"
import { apiFetch } from "@/lib/api-fetch"
import { buildJobArtifactHref } from "@/lib/job-artifacts"
import type { JobRecord } from "@/types/job"
import {
  buildSmartCropBoxPercent,
  clampSmartCropBoxPercent,
  findActiveSmartCropSegment,
  formatSmartCropTime,
  interpolateSmartCropKeyframe,
  parseSmartCropPlanForPlayer,
  type SmartCropPlanForPlayer,
  type SmartCropPlanSegment,
} from "./smart-crop-plan-player"

type PlanLoadState =
  | { status: "waiting"; message: string }
  | { status: "loading" }
  | { status: "ready"; plan: SmartCropPlanForPlayer }
  | { status: "failed"; message: string }

type SmartCropPlanReviewPlayerProps = {
  job: JobRecord
}

function buildMuxPlaybackUrl(playbackId: string): string {
  return `https://stream.mux.com/${playbackId}.m3u8`
}

function formatConfidence(confidence: number): string {
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`
}

function formatShotRange(segment: SmartCropPlanSegment): string {
  return `${formatSmartCropTime(segment.canonicalStart)}-${formatSmartCropTime(
    segment.canonicalEnd,
  )}`
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function getModeClass(mode: string): string {
  return mode.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()
}

function SmartCropPlanVideo({ plan }: { plan: SmartCropPlanForPlayer }) {
  const playerRef = useRef<Player | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const sourceAspectStyle = useMemo<CSSProperties>(
    () => ({
      aspectRatio: `${plan.source.width} / ${plan.source.height}`,
    }),
    [plan.source.height, plan.source.width],
  )
  const textTracks = useMemo(() => [], [])
  const handlePlayerReady = useCallback((nextPlayer: Player) => {
    playerRef.current = nextPlayer
    setPlayer(nextPlayer)
  }, [])
  const { containerRef, videoRef } = useVideoPlayerCore({
    src: buildMuxPlaybackUrl(plan.playbackId),
    textTracks,
    nativeControls: true,
    onPlayerReady: handlePlayerReady,
  })

  useEffect(() => {
    if (!player) return

    const syncTime = () => {
      setCurrentTime(player.currentTime() ?? 0)
    }

    player.on("timeupdate", syncTime)
    player.on("loadedmetadata", syncTime)
    player.on("seeked", syncTime)
    syncTime()

    return () => {
      player.off("timeupdate", syncTime)
      player.off("loadedmetadata", syncTime)
      player.off("seeked", syncTime)
    }
  }, [player])

  const activeSegment = useMemo(
    () => findActiveSmartCropSegment(plan.segments, currentTime),
    [currentTime, plan.segments],
  )
  const activeKeyframe = activeSegment
    ? interpolateSmartCropKeyframe(activeSegment, currentTime)
    : null
  const cropBox = activeKeyframe
    ? clampSmartCropBoxPercent(
        buildSmartCropBoxPercent(activeKeyframe, plan.source),
      )
    : null
  const cropBoxStyle = cropBox
    ? ({
        left: `${cropBox.left}%`,
        top: `${cropBox.top}%`,
        width: `${cropBox.width}%`,
        height: `${cropBox.height}%`,
      } satisfies CSSProperties)
    : undefined
  const timelineDuration = plan.source.durationSeconds
  const playheadPercent = clampPercent((currentTime / timelineDuration) * 100)

  const seekTo = useCallback((seconds: number) => {
    const currentPlayer = playerRef.current
    if (!currentPlayer) return
    currentPlayer.currentTime(seconds)
    setCurrentTime(seconds)
  }, [])

  return (
    <div className="smart-crop-plan-player">
      <div className="smart-crop-plan-player-stage" style={sourceAspectStyle}>
        <div className="smart-crop-plan-player-video-shell" ref={containerRef}>
          <video
            className="video-js vjs-fluid vjs-default-skin smart-crop-plan-player-video"
            ref={videoRef}
            playsInline
          />
        </div>
        {cropBoxStyle ? (
          <div className="smart-crop-plan-crop-box" style={cropBoxStyle}>
            <span>9:16</span>
          </div>
        ) : null}
      </div>

      <div className="smart-crop-shot-summary">
        <dl className="smart-crop-shot-readout">
          <div>
            <dt className="small jobs-field-label">Shot</dt>
            <dd>
              {activeSegment
                ? `${activeSegment.shotId} · ${formatShotRange(activeSegment)}`
                : "–"}
            </dd>
          </div>
          <div>
            <dt className="small jobs-field-label">Mode</dt>
            <dd>{activeSegment?.mode ?? "–"}</dd>
          </div>
          <div>
            <dt className="small jobs-field-label">Subject</dt>
            <dd>{activeSegment?.primarySubject ?? "–"}</dd>
          </div>
          <div>
            <dt className="small jobs-field-label">Confidence</dt>
            <dd>
              {activeSegment ? formatConfidence(activeSegment.confidence) : "–"}
            </dd>
          </div>
        </dl>

        <div className="smart-crop-shot-timeline-wrap">
          <div
            className="smart-crop-shot-timeline"
            aria-label="Smart Crop shot timeline"
          >
            {plan.segments.map((segment) => {
              const left = clampPercent(
                (segment.canonicalStart / timelineDuration) * 100,
              )
              const width = clampPercent(
                ((segment.canonicalEnd - segment.canonicalStart) /
                  timelineDuration) *
                  100,
              )
              const isActive = segment.shotId === activeSegment?.shotId

              return (
                <button
                  key={segment.shotId}
                  type="button"
                  className={`smart-crop-shot-segment smart-crop-shot-segment--${getModeClass(
                    segment.mode,
                  )}${isActive ? " is-active" : ""}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                  }}
                  title={`${segment.shotId} · ${segment.mode} · ${formatShotRange(
                    segment,
                  )}`}
                  aria-label={`${segment.shotId}, ${segment.mode}, ${formatShotRange(
                    segment,
                  )}`}
                  aria-pressed={isActive}
                  onClick={() => seekTo(segment.canonicalStart)}
                />
              )
            })}
            <span
              className="smart-crop-shot-playhead"
              style={{ left: `${playheadPercent}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="smart-crop-shot-timeline-labels">
            <span>{formatSmartCropTime(0)}</span>
            <span>{formatSmartCropTime(timelineDuration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SmartCropPlanReviewPlayer({
  job,
}: SmartCropPlanReviewPlayerProps) {
  const hasPlanArtifact =
    job.artifacts["smart-crop-plan"]?.kind === "downloadable"
  const [planState, setPlanState] = useState<PlanLoadState>(() =>
    hasPlanArtifact
      ? { status: "loading" }
      : {
          status: "waiting",
          message: "Crop plan artifact unavailable.",
        },
  )

  useEffect(() => {
    let cancelled = false

    async function loadPlan() {
      if (!hasPlanArtifact) {
        setPlanState({
          status: "waiting",
          message: "Crop plan artifact unavailable.",
        })
        return
      }

      setPlanState({ status: "loading" })

      try {
        const response = await apiFetch(
          buildJobArtifactHref(job.id, "smart-crop-plan"),
          { cache: "no-store" },
        )
        if (!response.ok) {
          if (!cancelled) {
            setPlanState({
              status: "failed",
              message: "Failed to load crop plan artifact.",
            })
          }
          return
        }

        const payload = await response.json()
        const plan = parseSmartCropPlanForPlayer(payload)
        if (!plan) {
          if (!cancelled) {
            setPlanState({
              status: "failed",
              message: "Crop plan artifact is malformed.",
            })
          }
          return
        }

        if (!cancelled) {
          setPlanState({ status: "ready", plan })
        }
      } catch {
        if (!cancelled) {
          setPlanState({
            status: "failed",
            message: "Failed to load crop plan artifact.",
          })
        }
      }
    }

    void loadPlan()

    return () => {
      cancelled = true
    }
  }, [hasPlanArtifact, job.id])

  return (
    <section className="collection-card jobs-card smart-crop-plan-review-card">
      <div className="jobs-card-header">
        <h3 className="jobs-section-title">Original crop guide</h3>
        <span className="smart-crop-plan-player-status">
          {planState.status}
        </span>
      </div>

      {planState.status === "ready" ? (
        <SmartCropPlanVideo plan={planState.plan} />
      ) : (
        <div className="smart-crop-plan-player-empty" role="status">
          <strong>
            {planState.status === "loading" ? "Loading crop plan" : "No guide"}
          </strong>
          <p>
            {planState.status === "loading"
              ? "Loading crop plan artifact."
              : planState.message}
          </p>
        </div>
      )}
    </section>
  )
}
