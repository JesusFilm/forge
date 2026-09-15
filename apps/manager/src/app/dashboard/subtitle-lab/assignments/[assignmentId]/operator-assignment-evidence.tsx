"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useVideoPlayerCore } from "@forge/video-player"
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Repeat2,
  VideoOff,
} from "lucide-react"
import type Player from "video.js/dist/types/player"

import {
  alignSubtitleSegments,
  boundSegmentWindow,
  findActiveSegmentIndex,
  formatSubtitleTime,
  navigateSegmentIndex,
  parseWebVtt,
} from "@/features/subtitle-lab/subtitle-review-presenter"
import { diffSubtitleText } from "@/features/subtitle-lab/subtitle-segment-diff"

import {
  loadOperatorAssignmentEvidence,
  type OperatorAssignmentEvidenceState,
} from "./operator-assignment-data"

const PANEL =
  "rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5"

export function OperatorAssignmentEvidence({
  assignmentId,
}: {
  assignmentId: string
}) {
  const [state, setState] = useState<OperatorAssignmentEvidenceState>({
    status: "loading",
  })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    void loadOperatorAssignmentEvidence(assignmentId).then((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
    }
  }, [assignmentId, retry])

  if (state.status === "loading") {
    return (
      <section className={PANEL} role="status">
        Loading named subtitle evidence…
      </section>
    )
  }
  if (state.status === "not-found") {
    return (
      <section className={PANEL} role="status">
        Assignment evidence is no longer available.
      </section>
    )
  }
  if (state.status === "error") {
    return (
      <section className={PANEL} role="status">
        <p>{state.message}</p>
        <button
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] px-3 py-2 text-sm font-semibold"
          onClick={() => {
            setState({ status: "loading" })
            setRetry((value) => value + 1)
          }}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} /> Retry evidence
        </button>
      </section>
    )
  }
  return <ReadyOperatorEvidence state={state} />
}

function ReadyOperatorEvidence({
  state,
}: {
  state: Extract<OperatorAssignmentEvidenceState, { status: "ready" }>
}) {
  const segments = useMemo(
    () =>
      alignSubtitleSegments({
        source: parseWebVtt(state.sourceVtt),
        trackA: parseWebVtt(state.referenceVtt),
        trackB: parseWebVtt(state.candidateVtt),
      }),
    [state.candidateVtt, state.referenceVtt, state.sourceVtt],
  )
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loop, setLoop] = useState(false)
  const [player, setPlayer] = useState<Player | null>(null)
  const selected = segments[selectedIndex]
  const readyVideo = state.video.status === "ready" ? state.video : null

  const selectSegment = useCallback(
    (index: number) => {
      const segment = segments[index]
      if (!segment) return
      setSelectedIndex(index)
      if (!player || !readyVideo) return
      const window = boundSegmentWindow(
        readyVideo.clip.startSeconds,
        readyVideo.clip.endSeconds,
        segment,
      )
      player.currentTime(window.startSeconds)
      void player.play()
    },
    [player, readyVideo, segments],
  )

  useEffect(() => {
    if (!player || !readyVideo || !selected) return
    const onTimeUpdate = () => {
      const currentTime = player.currentTime() ?? 0
      const window = boundSegmentWindow(
        readyVideo.clip.startSeconds,
        readyVideo.clip.endSeconds,
        selected,
      )
      if (loop && currentTime >= window.endSeconds) {
        player.currentTime(window.startSeconds)
        if (!player.paused()) void player.play()
      } else if (!loop && currentTime >= readyVideo.clip.endSeconds) {
        player.pause()
      } else if (!loop) {
        setSelectedIndex(findActiveSegmentIndex(segments, currentTime))
      }
    }
    player.on("timeupdate", onTimeUpdate)
    return () => {
      player.off("timeupdate", onTimeUpdate)
    }
  }, [loop, player, readyVideo, segments, selected])

  const navigate = (delta: -1 | 1) =>
    selectSegment(navigateSegmentIndex(selectedIndex, delta, segments.length))

  return (
    <section
      className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.6fr)]"
      aria-labelledby="operator-evidence-title"
    >
      <aside className={`${PANEL} h-fit xl:sticky xl:top-4`}>
        <h2 className="text-xl font-semibold" id="operator-evidence-title">
          Named review evidence
        </h2>
        <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
          Human reference and AI candidate are operator-only provenance labels.
          Difference marks remain neutral scanning aids.
        </p>
        {readyVideo ? (
          <OperatorVideo
            video={readyVideo}
            onReady={(readyPlayer) => {
              setPlayer(readyPlayer)
              readyPlayer.currentTime(readyVideo.clip.startSeconds)
            }}
          />
        ) : (
          <div className="mt-4 rounded-[var(--ds-radius)] border border-dashed border-[color:var(--ds-line-strong)] p-6 text-center">
            <VideoOff aria-hidden="true" className="mx-auto" />
            <strong className="mt-2 block">Video playback unavailable</strong>
            <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
              Named text evidence remains available.
            </p>
          </div>
        )}
        <nav
          className="mt-4 grid grid-cols-3 gap-2"
          aria-label="Operator segment navigation"
        >
          <button
            className="min-h-10 rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] px-2 text-sm"
            disabled={selectedIndex <= 0}
            onClick={() => navigate(-1)}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="inline" size={15} />{" "}
            Previous
          </button>
          <button
            className="min-h-10 rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] px-2 text-sm"
            aria-pressed={loop}
            onClick={() => setLoop((value) => !value)}
            type="button"
          >
            <Repeat2 aria-hidden="true" className="inline" size={15} /> Loop
          </button>
          <button
            className="min-h-10 rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] px-2 text-sm"
            disabled={selectedIndex >= segments.length - 1}
            onClick={() => navigate(1)}
            type="button"
          >
            Next <ArrowRight aria-hidden="true" className="inline" size={15} />
          </button>
        </nav>
      </aside>

      <section
        className={`${PANEL} min-w-0`}
        aria-label="Named subtitle comparison"
      >
        <div className="grid gap-3">
          {segments.map((segment, index) => {
            const diff = diffSubtitleText(
              segment.trackAText,
              segment.trackBText,
            )
            return (
              <article
                className={`rounded-[var(--ds-radius)] border p-3 ${index === selectedIndex ? "border-[color:var(--ds-black)]" : "border-[color:var(--ds-line)]"}`}
                key={segment.id}
              >
                <button
                  className="text-left text-xs font-semibold"
                  onClick={() => selectSegment(index)}
                  type="button"
                >
                  ▶ {formatSubtitleTime(segment.startSeconds)}–
                  {formatSubtitleTime(segment.endSeconds)} ·{" "}
                  {segment.lexicalDifference ? "text differs" : "similar text"}
                  {segment.timingDifference ? " · timing differs" : ""}
                </button>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <EvidenceColumn
                    label="Source context"
                    text={segment.sourceText}
                  />
                  <EvidenceColumn label="Human reference" tokens={diff.left} />
                  <EvidenceColumn label="AI candidate" tokens={diff.right} />
                </div>
              </article>
            )
          })}
          {segments.length === 0 ? (
            <p className="text-sm text-[color:var(--ds-muted)]">
              The retained tracks have no reviewable cues.
            </p>
          ) : null}
        </div>
      </section>
    </section>
  )
}

function EvidenceColumn({
  label,
  text,
  tokens,
}: {
  label: string
  text?: string
  tokens?: Array<{ text: string; changed: boolean }>
}) {
  return (
    <section className="min-w-0 rounded-[var(--ds-radius)] bg-[color:var(--ds-hover)] p-3">
      <strong className="text-xs uppercase tracking-wide">{label}</strong>
      <bdi className="mt-2 block whitespace-pre-line text-sm" dir="auto">
        {tokens
          ? tokens.map((token, index) => (
              <span
                className={
                  token.changed ? "subtitle-review-token-changed" : undefined
                }
                key={`${index}:${token.text}`}
              >
                {token.text}
              </span>
            ))
          : text || "No overlapping cue"}
      </bdi>
    </section>
  )
}

function OperatorVideo({
  video,
  onReady,
}: {
  video: Extract<
    Extract<OperatorAssignmentEvidenceState, { status: "ready" }>["video"],
    { status: "ready" }
  >
  onReady: (player: Player) => void
}) {
  const { containerRef, videoRef } = useVideoPlayerCore({
    src: video.playbackUrl,
    nativeControls: true,
    onPlayerReady: onReady,
  })
  return (
    <div className="mt-4">
      <div
        ref={containerRef}
        className="overflow-hidden rounded-[var(--ds-radius)] bg-black"
      >
        <video
          ref={videoRef}
          className="video-js vjs-fluid vjs-default-skin"
          playsInline
        />
      </div>
      <p className="mt-2 text-xs text-[color:var(--ds-muted)]">
        Frozen clip {formatSubtitleTime(video.clip.startSeconds)}–
        {formatSubtitleTime(video.clip.endSeconds)}
      </p>
    </div>
  )
}
