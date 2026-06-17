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
import { CircleAlert, Info, TriangleAlert, type LucideIcon } from "lucide-react"
import type Player from "video.js/dist/types/player"
import { apiFetch } from "@/lib/api-fetch"
import { buildJobArtifactHref } from "@/lib/job-artifacts"
import type { JobRecord } from "@/types/job"
import {
  buildSmartCropQaMarkers,
  buildSmartCropBoxPercent,
  clampSmartCropBoxPercent,
  findActiveSmartCropSegment,
  formatSmartCropTime,
  interpolateSmartCropKeyframe,
  isSmartCropAttemptSelectableForReview,
  parseSmartCropQaIssuesForPlayer,
  parseSmartCropPlanForPlayer,
  type SmartCropQaIssueForPlayer,
  type SmartCropQaMarkerForPlayer,
  type SmartCropPlanForPlayer,
  type SmartCropPlanSegment,
} from "./smart-crop-plan-player"

type PlanLoadState =
  | { status: "waiting"; message: string }
  | { status: "loading" }
  | { status: "ready"; plan: SmartCropPlanForPlayer }
  | { status: "failed"; message: string }

export type SmartCropAttemptSelection = {
  attemptIndex: number
  manifestDigest: string
}

type SmartCropAttemptIssue = SmartCropQaIssueForPlayer

type SmartCropAttemptForReview = {
  attemptIndex: number
  status: string
  source: "initial" | "repair"
  planLogicalKey: string
  previewLogicalKey: string
  qaLogicalKey: string
  triggerIssues: SmartCropAttemptIssue[]
  qa?: {
    verdict?: "pass" | "needs_repair" | "fail"
    unavailableReason?: string
    issueCount: number
    repairTriggerCount: number
  }
}

type AttemptsLoadState =
  | { status: "none" }
  | { status: "loading" }
  | {
      status: "ready"
      manifestDigest: string
      selectedAttemptIndex?: number
      attempts: SmartCropAttemptForReview[]
    }
  | { status: "failed"; message: string }

type QaIssuesLoadState = {
  status: "ready" | "loading" | "failed"
  logicalKey: string
  issues: readonly SmartCropAttemptIssue[]
}

type SmartCropPlanReviewPlayerProps = {
  job: JobRecord
  onSelectedAttemptChange?: (
    selection: SmartCropAttemptSelection | null,
  ) => void
}

const EMPTY_QA_ISSUES: readonly SmartCropAttemptIssue[] = []

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function parseAttemptIssue(value: unknown): SmartCropAttemptIssue | null {
  if (!isRecord(value)) return null
  if (
    value.severity !== "info" &&
    value.severity !== "warning" &&
    value.severity !== "critical"
  ) {
    return null
  }
  if (typeof value.description !== "string") return null
  return {
    severity: value.severity,
    description: value.description,
    atSeconds:
      typeof value.atSeconds === "number" ? value.atSeconds : undefined,
    shotId: typeof value.shotId === "string" ? value.shotId : undefined,
  }
}

function parseAttemptForReview(
  value: unknown,
): SmartCropAttemptForReview | null {
  if (!isRecord(value)) return null
  if (
    typeof value.attemptIndex !== "number" ||
    (value.source !== "initial" && value.source !== "repair") ||
    typeof value.status !== "string" ||
    typeof value.planLogicalKey !== "string" ||
    typeof value.previewLogicalKey !== "string" ||
    typeof value.qaLogicalKey !== "string"
  ) {
    return null
  }
  const qa = isRecord(value.qa) ? value.qa : null
  return {
    attemptIndex: value.attemptIndex,
    status: value.status,
    source: value.source,
    planLogicalKey: value.planLogicalKey,
    previewLogicalKey: value.previewLogicalKey,
    qaLogicalKey: value.qaLogicalKey,
    triggerIssues: Array.isArray(value.triggerIssues)
      ? value.triggerIssues
          .map(parseAttemptIssue)
          .filter((issue) => issue != null)
      : [],
    ...(qa && typeof qa.issueCount === "number"
      ? {
          qa: {
            verdict:
              qa.verdict === "pass" ||
              qa.verdict === "needs_repair" ||
              qa.verdict === "fail"
                ? qa.verdict
                : undefined,
            unavailableReason:
              typeof qa.unavailableReason === "string"
                ? qa.unavailableReason
                : undefined,
            issueCount: qa.issueCount,
            repairTriggerCount:
              typeof qa.repairTriggerCount === "number"
                ? qa.repairTriggerCount
                : 0,
          },
        }
      : {}),
  }
}

function parseAttemptsForReview(value: unknown): {
  manifestDigest: string
  selectedAttemptIndex?: number
  attempts: SmartCropAttemptForReview[]
} | null {
  if (!isRecord(value) || value.kind !== "smart-crop-attempts") return null
  if (
    !Array.isArray(value.attempts) ||
    typeof value.manifestDigest !== "string"
  ) {
    return null
  }
  const attempts = value.attempts
    .map(parseAttemptForReview)
    .filter((attempt) => attempt != null)
    .sort((left, right) => left.attemptIndex - right.attemptIndex)
  if (attempts.length === 0) return null
  return {
    manifestDigest: value.manifestDigest,
    selectedAttemptIndex:
      typeof value.selectedAttemptIndex === "number"
        ? value.selectedAttemptIndex
        : undefined,
    attempts,
  }
}

function pickDefaultAttemptIndex(
  state: Extract<AttemptsLoadState, { status: "ready" }>,
): number {
  if (state.selectedAttemptIndex != null) {
    const selected = state.attempts.find(
      (attempt) => attempt.attemptIndex === state.selectedAttemptIndex,
    )
    if (selected && isSmartCropAttemptSelectableForReview(selected.status)) {
      return state.selectedAttemptIndex
    }
  }
  return (
    [...state.attempts]
      .reverse()
      .find((attempt) => isSmartCropAttemptSelectableForReview(attempt.status))
      ?.attemptIndex ?? state.attempts.at(-1)!.attemptIndex
  )
}

function formatAttemptTitle(attempt: SmartCropAttemptForReview): string {
  const label =
    attempt.attemptIndex === 0 ? "Initial" : `Attempt ${attempt.attemptIndex}`
  return `${label} · ${attempt.status.replace(/_/g, " ")}`
}

function formatQaSeverityLabel(
  severity: SmartCropAttemptIssue["severity"],
): string {
  switch (severity) {
    case "critical":
      return "Fail"
    case "warning":
      return "Warning"
    case "info":
      return "Message"
  }
}

function getQaSeverityIcon(
  severity: SmartCropAttemptIssue["severity"],
): LucideIcon {
  switch (severity) {
    case "critical":
      return CircleAlert
    case "warning":
      return TriangleAlert
    case "info":
      return Info
  }
}

function formatQaIssueMeta(issue: SmartCropAttemptIssue): string {
  return [
    issue.shotId,
    issue.atSeconds != null ? formatSmartCropTime(issue.atSeconds) : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function formatQaMarkerLabel(marker: SmartCropQaMarkerForPlayer): string {
  return [
    `${formatQaSeverityLabel(marker.severity)}: ${marker.description}`,
    marker.shotId ?? marker.segment?.shotId,
    formatSmartCropTime(marker.seconds),
  ]
    .filter(Boolean)
    .join(" · ")
}

function SmartCropPlanVideo({
  plan,
  qaIssues = EMPTY_QA_ISSUES,
}: {
  plan: SmartCropPlanForPlayer
  qaIssues?: readonly SmartCropAttemptIssue[]
}) {
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
  const qaMarkers = useMemo(
    () => buildSmartCropQaMarkers(plan.segments, qaIssues, timelineDuration),
    [plan.segments, qaIssues, timelineDuration],
  )

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
            {qaMarkers.map((marker) => {
              const Icon = getQaSeverityIcon(marker.severity)
              const label = formatQaMarkerLabel(marker)

              return (
                <button
                  key={marker.markerId}
                  type="button"
                  className={`smart-crop-shot-qa-marker smart-crop-shot-qa-marker--${marker.severity}`}
                  style={{ left: `${clampPercent(marker.percent)}%` }}
                  title={label}
                  aria-label={label}
                  onClick={() => seekTo(marker.seconds)}
                >
                  <Icon size={13} aria-hidden="true" />
                  <span
                    className="smart-crop-shot-qa-marker-tooltip"
                    role="tooltip"
                  >
                    {label}
                  </span>
                </button>
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
  onSelectedAttemptChange,
}: SmartCropPlanReviewPlayerProps) {
  const hasAttemptManifest =
    job.artifacts["smart-crop-attempts"]?.kind === "downloadable"
  const hasLegacyPlanArtifact =
    job.artifacts["smart-crop-plan"]?.kind === "downloadable"
  const [attemptsState, setAttemptsState] = useState<AttemptsLoadState>(() =>
    hasAttemptManifest ? { status: "loading" } : { status: "none" },
  )
  const [selectedAttemptIndex, setSelectedAttemptIndex] = useState(0)
  const [planState, setPlanState] = useState<PlanLoadState>(() =>
    hasLegacyPlanArtifact
      ? { status: "loading" }
      : {
          status: "waiting",
          message: "Crop plan artifact unavailable.",
        },
  )
  const [qaIssuesState, setQaIssuesState] = useState<QaIssuesLoadState>({
    status: "ready",
    logicalKey: "smart-crop-qa",
    issues: EMPTY_QA_ISSUES,
  })

  useEffect(() => {
    let cancelled = false

    async function loadAttempts() {
      if (!hasAttemptManifest) {
        setAttemptsState({ status: "none" })
        setSelectedAttemptIndex(0)
        return
      }

      setAttemptsState({ status: "loading" })
      try {
        const response = await apiFetch(
          buildJobArtifactHref(job.id, "smart-crop-attempts"),
          { cache: "no-store" },
        )
        if (!response.ok) {
          if (!cancelled) {
            setAttemptsState({
              status: "failed",
              message: "Failed to load crop attempts.",
            })
          }
          return
        }
        const parsed = parseAttemptsForReview(await response.json())
        if (!parsed) {
          if (!cancelled) {
            setAttemptsState({
              status: "failed",
              message: "Crop attempt manifest is malformed.",
            })
          }
          return
        }
        const nextState = { status: "ready" as const, ...parsed }
        if (!cancelled) {
          setAttemptsState(nextState)
          setSelectedAttemptIndex(pickDefaultAttemptIndex(nextState))
        }
      } catch {
        if (!cancelled) {
          setAttemptsState({
            status: "failed",
            message: "Failed to load crop attempts.",
          })
        }
      }
    }

    void loadAttempts()
    return () => {
      cancelled = true
    }
  }, [hasAttemptManifest, job.id])

  const selectedAttempt =
    attemptsState.status === "ready"
      ? (attemptsState.attempts.find(
          (attempt) => attempt.attemptIndex === selectedAttemptIndex,
        ) ?? null)
      : null
  const selectedPlanKey = selectedAttempt?.planLogicalKey ?? "smart-crop-plan"
  const selectedPreviewKey =
    selectedAttempt?.previewLogicalKey ?? "smart-crop-preview"
  const selectedQaKey = selectedAttempt?.qaLogicalKey ?? "smart-crop-qa"
  const fallbackQaIssues = selectedAttempt?.triggerIssues ?? EMPTY_QA_ISSUES
  const hasSelectedPlanArtifact =
    job.artifacts[selectedPlanKey]?.kind === "downloadable"
  const hasSelectedPreviewArtifact =
    job.artifacts[selectedPreviewKey]?.kind === "downloadable"
  const hasSelectedQaArtifact =
    job.artifacts[selectedQaKey]?.kind === "downloadable"
  const qaIssuesForReview =
    qaIssuesState.logicalKey === selectedQaKey
      ? qaIssuesState.issues
      : fallbackQaIssues

  useEffect(() => {
    if (
      attemptsState.status === "ready" &&
      selectedAttempt &&
      isSmartCropAttemptSelectableForReview(selectedAttempt.status)
    ) {
      onSelectedAttemptChange?.({
        attemptIndex: selectedAttempt.attemptIndex,
        manifestDigest: attemptsState.manifestDigest,
      })
      return
    }
    onSelectedAttemptChange?.(null)
  }, [attemptsState, onSelectedAttemptChange, selectedAttempt])

  useEffect(() => {
    let cancelled = false

    async function loadQaIssues() {
      if (hasAttemptManifest && attemptsState.status === "loading") {
        return
      }

      if (!hasSelectedQaArtifact) {
        setQaIssuesState({
          status: "ready",
          logicalKey: selectedQaKey,
          issues: fallbackQaIssues,
        })
        return
      }

      setQaIssuesState({
        status: "loading",
        logicalKey: selectedQaKey,
        issues: fallbackQaIssues,
      })

      try {
        const response = await apiFetch(
          buildJobArtifactHref(job.id, selectedQaKey),
          { cache: "no-store" },
        )
        if (!response.ok) {
          if (!cancelled) {
            setQaIssuesState({
              status: "failed",
              logicalKey: selectedQaKey,
              issues: fallbackQaIssues,
            })
          }
          return
        }

        const issues = parseSmartCropQaIssuesForPlayer(await response.json())
        if (!cancelled) {
          setQaIssuesState({
            status: "ready",
            logicalKey: selectedQaKey,
            issues,
          })
        }
      } catch {
        if (!cancelled) {
          setQaIssuesState({
            status: "failed",
            logicalKey: selectedQaKey,
            issues: fallbackQaIssues,
          })
        }
      }
    }

    void loadQaIssues()

    return () => {
      cancelled = true
    }
  }, [
    attemptsState.status,
    fallbackQaIssues,
    hasAttemptManifest,
    hasSelectedQaArtifact,
    job.id,
    selectedQaKey,
  ])

  useEffect(() => {
    let cancelled = false

    async function loadPlan() {
      if (hasAttemptManifest && attemptsState.status === "loading") {
        return
      }
      if (!hasSelectedPlanArtifact) {
        setPlanState({
          status: "waiting",
          message: "Crop plan artifact unavailable.",
        })
        return
      }

      setPlanState({ status: "loading" })

      try {
        const response = await apiFetch(
          buildJobArtifactHref(job.id, selectedPlanKey),
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
  }, [
    attemptsState.status,
    hasAttemptManifest,
    hasSelectedPlanArtifact,
    job.id,
    selectedPlanKey,
  ])

  return (
    <section className="collection-card jobs-card smart-crop-plan-review-card">
      <div className="jobs-card-header">
        <h3 className="jobs-section-title">Crop attempt review</h3>
        <span className="smart-crop-plan-player-status">
          {planState.status}
        </span>
      </div>

      {attemptsState.status === "ready" ? (
        <div className="smart-crop-attempt-selector" role="group">
          {attemptsState.attempts.map((attempt) => (
            <button
              key={attempt.attemptIndex}
              type="button"
              className={`smart-crop-attempt-button${
                attempt.attemptIndex === selectedAttemptIndex
                  ? " is-selected"
                  : ""
              }`}
              onClick={() => setSelectedAttemptIndex(attempt.attemptIndex)}
            >
              <span>{formatAttemptTitle(attempt)}</span>
              <small>
                {attempt.qa?.verdict ??
                  attempt.qa?.unavailableReason ??
                  "pending"}
                {attempt.qa ? ` · ${attempt.qa.issueCount} issues` : ""}
              </small>
            </button>
          ))}
        </div>
      ) : attemptsState.status === "failed" ? (
        <p className="jobs-error-text">{attemptsState.message}</p>
      ) : null}

      {planState.status === "ready" ? (
        <>
          <SmartCropPlanVideo
            plan={planState.plan}
            qaIssues={qaIssuesForReview}
          />
          <div className="smart-crop-attempt-review-grid">
            {hasSelectedPreviewArtifact ? (
              <div className="smart-crop-attempt-preview">
                <h4>9:16 preview</h4>
                <video
                  controls
                  preload="metadata"
                  src={buildJobArtifactHref(job.id, selectedPreviewKey)}
                />
              </div>
            ) : null}
            {selectedAttempt ? (
              <div className="smart-crop-attempt-qa">
                <h4>QA report</h4>
                <dl>
                  <div>
                    <dt>Verdict</dt>
                    <dd>
                      {selectedAttempt.qa?.verdict ??
                        selectedAttempt.qa?.unavailableReason ??
                        "pending"}
                    </dd>
                  </div>
                  <div>
                    <dt>Repair triggers</dt>
                    <dd>{selectedAttempt.qa?.repairTriggerCount ?? 0}</dd>
                  </div>
                </dl>
                {qaIssuesForReview.length > 0 ? (
                  <ul>
                    {qaIssuesForReview.map((issue, index) => (
                      <li key={`${issue.description}-${index}`}>
                        <strong>{formatQaSeverityLabel(issue.severity)}</strong>
                        <span>{issue.description}</span>
                        <small>{formatQaIssueMeta(issue)}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No QA issues for this attempt.</p>
                )}
              </div>
            ) : null}
          </div>
        </>
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
