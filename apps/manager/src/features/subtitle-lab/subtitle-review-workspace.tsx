"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useVideoPlayerCore } from "@forge/video-player"
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Repeat2,
  VideoOff,
} from "lucide-react"
import type Player from "video.js/dist/types/player"

import {
  loadReviewerAssignment,
  type ReviewerAssignmentLoadState,
  type ReviewVideoContext,
} from "./subtitle-review-data"
import { SubtitleReviewForm } from "./subtitle-review-form"
import {
  alignSubtitleSegments,
  boundSegmentWindow,
  findActiveSegmentIndex,
  formatSubtitleTime,
  navigateSegmentIndex,
  parseWebVtt,
} from "./subtitle-review-presenter"
import { SubtitleSegmentDiff } from "./subtitle-segment-diff"

export type ReviewerLanguagePresentation = {
  languageId: string
  languageSlug: string
  languageBcp47?: string
  specialistAllowed: boolean
}

export function SubtitleReviewWorkspace({
  assignmentId,
  reviewerLanguages,
  initialState,
}: {
  assignmentId: string
  reviewerLanguages: ReviewerLanguagePresentation[]
  initialState?: ReviewerAssignmentLoadState
}) {
  const [state, setState] = useState<ReviewerAssignmentLoadState>(
    initialState ?? { status: "loading" },
  )
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (initialState && retryNonce === 0) return
    let active = true
    void loadReviewerAssignment(assignmentId).then((nextState) => {
      if (active) setState(nextState)
    })
    return () => {
      active = false
    }
  }, [assignmentId, initialState, retryNonce])

  return (
    <main className="subtitle-review-workspace-page">
      <Link href="/subtitle-review" className="subtitle-review-back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Back to assigned reviews
      </Link>

      {state.status === "loading" ? (
        <WorkspaceState
          title="Loading review workspace"
          icon={<LoaderCircle className="subtitle-review-spin" />}
          live
        >
          Revalidating your assignment and loading frozen subtitle evidence…
        </WorkspaceState>
      ) : state.status === "not-found" ? (
        <WorkspaceState title="Review unavailable" icon={<LockKeyhole />} live>
          This review is not available. The assignment or your language access
          may have changed.
        </WorkspaceState>
      ) : state.status === "error" ? (
        <WorkspaceState
          title="Review temporarily unavailable"
          icon={<RefreshCw />}
          live
        >
          <span>{state.message}</span>
          <button
            type="button"
            className="subtitle-review-secondary-button"
            onClick={() => {
              setState({ status: "loading" })
              setRetryNonce((value) => value + 1)
            }}
          >
            Try again
          </button>
        </WorkspaceState>
      ) : (
        <ReadyReviewWorkspace
          assignmentId={assignmentId}
          state={state}
          reviewerLanguage={reviewerLanguages.find(
            (language) =>
              language.languageId === state.detail.targetLanguageId &&
              language.languageSlug === state.detail.targetLanguageSlug,
          )}
          onReload={async () => {
            const nextState = await loadReviewerAssignment(assignmentId)
            if (nextState.status !== "ready") {
              throw new Error("Submitted receipt was not available")
            }
            setState(nextState)
          }}
        />
      )}
    </main>
  )
}

function ReadyReviewWorkspace({
  assignmentId,
  state,
  reviewerLanguage,
  onReload,
}: {
  assignmentId: string
  state: Extract<ReviewerAssignmentLoadState, { status: "ready" }>
  reviewerLanguage?: ReviewerLanguagePresentation
  onReload: () => Promise<void>
}) {
  const locale = reviewerLanguage?.languageBcp47
  const segments = useMemo(
    () =>
      alignSubtitleSegments({
        source: parseWebVtt(state.sourceVtt),
        trackA: parseWebVtt(state.trackAVtt),
        trackB: parseWebVtt(state.trackBVtt),
        locale,
      }),
    [locale, state.sourceVtt, state.trackAVtt, state.trackBVtt],
  )
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loopSegment, setLoopSegment] = useState(false)
  const [mobileTrack, setMobileTrack] = useState<"source" | "A" | "B">("A")
  const [player, setPlayer] = useState<Player | null>(null)
  const [announcedStatus, setAnnouncedStatus] = useState("")
  const [correctionMode, setCorrectionMode] = useState(false)
  const [requestedCorrection, setRequestedCorrection] = useState<{
    segmentId: string
    track: "A" | "B"
    nonce: number
  }>()
  const selectedSegment = segments[selectedIndex] ?? segments[0]
  const receipt = state.detail.postSubmitReceipt
  const readyVideo = state.video.status === "ready" ? state.video : null
  const trackAProvenance = receipt
    ? receipt.referenceTrackLabel === "A"
      ? "human-reference"
      : "ai-candidate"
    : undefined
  const trackBProvenance = receipt
    ? receipt.referenceTrackLabel === "B"
      ? "human-reference"
      : "ai-candidate"
    : undefined

  const selectSegment = useCallback(
    (index: number, play = true) => {
      const segment = segments[index]
      if (!segment) return
      setSelectedIndex(index)
      setAnnouncedStatus(
        `Segment ${index + 1} of ${segments.length}, ${formatSubtitleTime(segment.startSeconds)} to ${formatSubtitleTime(segment.endSeconds)}`,
      )
      if (!player || !readyVideo) return
      const window = boundSegmentWindow(
        readyVideo.clip.startSeconds,
        readyVideo.clip.endSeconds,
        segment,
      )
      player.currentTime(window.startSeconds)
      if (play) void player.play()
    },
    [player, readyVideo, segments],
  )

  const navigate = useCallback(
    (delta: -1 | 1) => {
      selectSegment(navigateSegmentIndex(selectedIndex, delta, segments.length))
    },
    [segments.length, selectSegment, selectedIndex],
  )

  useEffect(() => {
    if (!player || !readyVideo || !selectedSegment) return
    const onTimeUpdate = () => {
      const currentTime = player.currentTime() ?? 0
      const window = boundSegmentWindow(
        readyVideo.clip.startSeconds,
        readyVideo.clip.endSeconds,
        selectedSegment,
      )
      if (loopSegment && currentTime >= window.endSeconds) {
        player.currentTime(window.startSeconds)
        if (!player.paused()) void player.play()
        return
      }
      if (!loopSegment && currentTime >= readyVideo.clip.endSeconds) {
        player.pause()
        return
      }
      if (!loopSegment) {
        setSelectedIndex(findActiveSegmentIndex(segments, currentTime))
      }
    }
    player.on("timeupdate", onTimeUpdate)
    return () => {
      player.off("timeupdate", onTimeUpdate)
    }
  }, [loopSegment, player, readyVideo, segments, selectedSegment])

  function handleKeyboard(event: React.KeyboardEvent<HTMLElement>) {
    if (isTextInput(event.target)) return
    if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault()
      navigate(-1)
    } else if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault()
      navigate(1)
    } else if (!event.altKey && event.key.toLocaleLowerCase() === "l") {
      event.preventDefault()
      setLoopSegment((value) => !value)
    }
  }

  return (
    <div className="subtitle-review-workspace" onKeyDown={handleKeyboard}>
      <header className="subtitle-review-detail-heading">
        <div>
          <p className="subtitle-review-eyebrow">Blind subtitle comparison</p>
          <h1>{humanize(state.detail.collectionKey)}</h1>
          <p>
            {humanize(state.detail.targetLanguageSlug)} · Review round{" "}
            {state.detail.round}
          </p>
        </div>
        <div className="subtitle-review-blind-badge">
          <Eye size={16} aria-hidden="true" />
          {receipt ? "Provenance revealed" : "Track identity hidden"}
        </div>
      </header>

      <div className="subtitle-review-primary-grid">
        <aside className="subtitle-review-player-column">
          {readyVideo ? (
            <SubtitleReviewVideo
              video={readyVideo}
              onReady={(readyPlayer) => {
                setPlayer(readyPlayer)
                readyPlayer.currentTime(readyVideo.clip.startSeconds)
              }}
            />
          ) : (
            <section
              className="subtitle-review-video-blocked"
              aria-live="polite"
            >
              <VideoOff aria-hidden="true" />
              <h2>Video playback unavailable</h2>
              <p>
                The public playback for this frozen edition is unavailable. You
                can still inspect and submit the subtitle evidence below.
              </p>
            </section>
          )}

          {selectedSegment ? (
            <section
              className="subtitle-review-selected-context"
              aria-label="Selected segment"
            >
              <div className="subtitle-review-selected-context-header">
                <strong>Selected segment {selectedIndex + 1}</strong>
                <span>
                  {formatSubtitleTime(selectedSegment.startSeconds)}–
                  {formatSubtitleTime(selectedSegment.endSeconds)}
                </span>
              </div>
              <bdi dir="auto">{selectedText(selectedSegment, mobileTrack)}</bdi>
            </section>
          ) : null}

          <nav
            className="subtitle-review-player-controls"
            aria-label="Segment navigation"
          >
            <button
              type="button"
              className="subtitle-review-secondary-button"
              onClick={() => navigate(-1)}
              disabled={selectedIndex <= 0}
              aria-keyshortcuts="Alt+ArrowLeft"
            >
              <ArrowLeft size={16} aria-hidden="true" /> Previous
            </button>
            <button
              type="button"
              className={`subtitle-review-secondary-button${loopSegment ? " is-active" : ""}`}
              onClick={() => setLoopSegment((value) => !value)}
              aria-pressed={loopSegment}
              aria-keyshortcuts="L"
            >
              <Repeat2 size={16} aria-hidden="true" />
              {loopSegment ? "Loop on" : "Loop segment"}
            </button>
            <button
              type="button"
              className="subtitle-review-secondary-button"
              onClick={() => navigate(1)}
              disabled={selectedIndex >= segments.length - 1}
              aria-keyshortcuts="Alt+ArrowRight"
            >
              Next <ArrowRight size={16} aria-hidden="true" />
            </button>
          </nav>
          <p className="subtitle-review-keyboard-hint small">
            Keyboard: Alt + ←/→ moves between segments; L toggles a loop bounded
            to 30 seconds.
          </p>
        </aside>

        <section
          className="subtitle-review-comparison"
          aria-labelledby="comparison-heading"
        >
          <header className="subtitle-review-comparison-heading">
            <div>
              <h2 id="comparison-heading">Source · Track A · Track B</h2>
              <p>
                Difference marks are neutral scanning aids, not error labels or
                human approval.
              </p>
            </div>
            <span>{segments.length} connected segments</span>
          </header>

          <div
            className="subtitle-review-mobile-tabs"
            role="group"
            aria-label="Visible subtitle track on narrow screens"
          >
            {(
              [
                ["source", "Source"],
                ["A", "Track A"],
                ["B", "Track B"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mobileTrack === value}
                onClick={() => setMobileTrack(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {segments.length === 0 ? (
            <WorkspaceState title="No subtitle segments" icon={<LockKeyhole />}>
              The frozen subtitle artifacts do not contain reviewable cues.
            </WorkspaceState>
          ) : (
            <div className="subtitle-review-segment-list">
              {segments.map((segment, index) => (
                <SubtitleSegmentDiff
                  key={segment.id}
                  segment={segment}
                  locale={locale}
                  selected={selectedIndex === index}
                  mobileTrack={mobileTrack}
                  trackAProvenance={trackAProvenance}
                  trackBProvenance={trackBProvenance}
                  onSelect={() => selectSegment(index)}
                  onAddCorrection={(track) =>
                    setRequestedCorrection({
                      segmentId: segment.id,
                      track,
                      nonce: Date.now(),
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {receipt ? (
        <PostSubmitReceipt
          receipt={receipt}
          onCorrect={() => setCorrectionMode(true)}
        />
      ) : null}

      {!receipt || correctionMode ? (
        <SubtitleReviewForm
          key={
            receipt && correctionMode
              ? `correction-${receipt.reviewId}`
              : "review"
          }
          assignmentId={assignmentId}
          segments={segments}
          specialistAllowed={reviewerLanguage?.specialistAllowed ?? false}
          allowSpecialistEscalation={state.detail.kind !== "SPECIALIST"}
          requestedCorrection={requestedCorrection}
          supersedesReviewId={receipt?.reviewId ?? null}
          onSubmitted={async () => {
            await onReload()
            setCorrectionMode(false)
            setAnnouncedStatus(
              "Review submitted. Track provenance and machine advisory signals are now revealed.",
            )
          }}
        />
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcedStatus}
      </p>
    </div>
  )
}

function SubtitleReviewVideo({
  video,
  onReady,
}: {
  video: Extract<ReviewVideoContext, { status: "ready" }>
  onReady: (player: Player) => void
}) {
  const { containerRef, videoRef } = useVideoPlayerCore({
    src: video.playbackUrl,
    nativeControls: true,
    onPlayerReady: onReady,
  })
  return (
    <section
      className="subtitle-review-video-card"
      aria-label="Review video player"
    >
      <div ref={containerRef} className="subtitle-review-video-stage">
        <video
          ref={videoRef}
          className="video-js vjs-fluid vjs-default-skin subtitle-review-video-element"
          playsInline
        />
      </div>
      <p className="small">
        Frozen clip: {formatSubtitleTime(video.clip.startSeconds)}–
        {formatSubtitleTime(video.clip.endSeconds)}
      </p>
    </section>
  )
}

function PostSubmitReceipt({
  receipt,
  onCorrect,
}: {
  receipt: NonNullable<
    Extract<
      ReviewerAssignmentLoadState,
      { status: "ready" }
    >["detail"]["postSubmitReceipt"]
  >
  onCorrect: () => void
}) {
  return (
    <section
      className="subtitle-review-receipt"
      aria-labelledby="receipt-heading"
    >
      <div>
        <p className="subtitle-review-eyebrow">Append-only receipt</p>
        <h2 id="receipt-heading">Review submitted</h2>
        <p>
          Provenance is revealed only after submission. Machine signals below
          remain advisory and do not replace your human judgment.
        </p>
      </div>
      <dl className="subtitle-review-receipt-grid">
        <div>
          <dt>Human reference</dt>
          <dd>Human reference · Track {receipt.referenceTrackLabel}</dd>
        </div>
        <div>
          <dt>Generated candidate</dt>
          <dd>AI candidate · Track {receipt.candidateTrackLabel}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatReceiptDate(receipt.submittedAt)}</dd>
        </div>
        <div>
          <dt>Resolved model</dt>
          <dd>{receipt.resolvedModel ?? "Not reported"}</dd>
        </div>
      </dl>
      <div className="subtitle-review-advisory">
        <strong>Machine advisory signals</strong>
        {receipt.machineAdvisoryRiskFlags.length > 0 ? (
          <ul>
            {receipt.machineAdvisoryRiskFlags.map((flag) => (
              <li key={flag}>{humanize(flag)}</li>
            ))}
          </ul>
        ) : (
          <p>No advisory risk flags were reported.</p>
        )}
      </div>
      <button
        type="button"
        className="subtitle-review-secondary-button"
        onClick={onCorrect}
      >
        Append a correction
      </button>
    </section>
  )
}

function WorkspaceState({
  title,
  icon,
  live = false,
  children,
}: {
  title: string
  icon: React.ReactNode
  live?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className="subtitle-review-state-card"
      aria-live={live ? "polite" : undefined}
    >
      <span aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <div className="subtitle-review-state-copy">{children}</div>
    </section>
  )
}

function selectedText(
  segment: {
    sourceText: string
    trackAText: string
    trackBText: string
  },
  track: "source" | "A" | "B",
) {
  if (track === "source") return segment.sourceText || "No source cue"
  if (track === "A") return segment.trackAText || "No Track A cue"
  return segment.trackBText || "No Track B cue"
}

function isTextInput(target: EventTarget) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLocaleLowerCase()
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase())
}

function formatReceiptDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return "Submitted"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
