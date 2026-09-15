import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@forge/video-player", () => ({
  useVideoPlayerCore: () => ({
    containerRef: { current: null },
    videoRef: { current: null },
    sliderRef: { current: null },
    timeRef: { current: null },
    isMuted: true,
    isPlaying: false,
    isFullscreen: false,
    handlePlayPause: vi.fn(),
    handleMuteToggle: vi.fn(),
    handleSeek: vi.fn(),
    handleFullscreen: vi.fn(),
  }),
}))

import { SubtitleReviewWorkspace } from "./subtitle-review-workspace"
import type { ReviewerAssignmentLoadState } from "./subtitle-review-data"

const vtt = "WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nHello world\n"

function readyState(
  submitted = false,
  videoReady = true,
  referenceTrackLabel: "A" | "B" = "B",
): ReviewerAssignmentLoadState {
  return {
    status: "ready",
    detail: {
      id: "assignment-private",
      status: submitted ? "SUBMITTED" : "ASSIGNED",
      kind: "STANDARD",
      round: 1,
      targetLanguageId: "language-private",
      targetLanguageSlug: "arabic",
      caseId: "case-private",
      collectionKey: "JESUS_FILM",
      videoId: "video-private",
      editionIdentity: "edition-private",
      clipStartSeconds: 10,
      clipEndSeconds: 20,
      submitted,
      postSubmitReceipt: submitted
        ? {
            reviewId: "review-private",
            submittedAt: "2026-08-20T12:00:00.000Z",
            referenceTrackLabel,
            candidateTrackLabel: referenceTrackLabel === "A" ? "B" : "A",
            machineAdvisoryRiskFlags: ["semantic-risk"],
            resolvedModel: "resolved-model-after-submit",
            assessmentDigest: "a".repeat(64),
          }
        : null,
      sourceTrack: {
        label: "SOURCE",
        contentId: "source-private",
        mediaType: "text/vtt",
      },
      trackA: {
        label: "A",
        contentId: "a-private",
        mediaType: "text/vtt",
      },
      trackB: {
        label: "B",
        contentId: "b-private",
        mediaType: "text/vtt",
      },
    },
    sourceVtt: vtt,
    trackAVtt: vtt.replace("Hello world", "مرحبا بالعالم"),
    trackBVtt: vtt.replace("Hello world", "مرحبا يا عالم"),
    video: videoReady
      ? {
          status: "ready",
          playbackId: "playback-public",
          playbackUrl: "https://stream.mux.com/playback-public.m3u8",
          durationSeconds: 100,
          clip: { startSeconds: 10, endSeconds: 20 },
        }
      : { status: "blocked", reason: "PLAYBACK_UNAVAILABLE" },
  }
}

describe("subtitle review workspace", () => {
  it("keeps the A/B comparison blind before submission", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleReviewWorkspace, {
        assignmentId: "assignment-private",
        reviewerLanguages: [
          {
            languageId: "language-private",
            languageSlug: "arabic",
            languageBcp47: "ar",
            specialistAllowed: false,
          },
        ],
        initialState: readyState(),
      }),
    )

    expect(markup).toContain("Track A")
    expect(markup).toContain("Track B")
    expect(markup).toContain("Source context")
    expect(markup).not.toContain("Human reference")
    expect(markup).not.toContain("AI candidate")
    expect(markup).not.toContain("resolved-model-after-submit")
    expect(markup).not.toContain("assignment-private")
    expect(markup).toContain('aria-keyshortcuts="Alt+ArrowLeft"')
    expect(markup).toContain('aria-keyshortcuts="Alt+ArrowRight"')
    expect(markup).toContain('aria-live="polite"')
  })

  it.each([
    ["A", "B"],
    ["B", "A"],
  ] as const)(
    "reveals the %s-reference/%s-candidate mapping only from a submitted receipt",
    (referenceTrack, candidateTrack) => {
      const markup = renderToStaticMarkup(
        React.createElement(SubtitleReviewWorkspace, {
          assignmentId: "assignment-private",
          reviewerLanguages: [
            {
              languageId: "language-private",
              languageSlug: "arabic",
              languageBcp47: "ar",
              specialistAllowed: false,
            },
          ],
          initialState: readyState(true, true, referenceTrack),
        }),
      )

      expect(markup).toContain(`Human reference · Track ${referenceTrack}`)
      expect(markup).toContain(`AI candidate · Track ${candidateTrack}`)
      expect(markup).toContain("resolved-model-after-submit")
      expect(markup).toContain("Semantic Risk")
      expect(markup).not.toContain("review-private")
      expect(markup).not.toContain("assessmentDigest")
    },
  )

  it("keeps text review usable when public playback is blocked", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleReviewWorkspace, {
        assignmentId: "assignment-private",
        reviewerLanguages: [],
        initialState: readyState(false, false),
      }),
    )

    expect(markup).toContain("Video playback unavailable")
    expect(markup).toContain("Track A")
    expect(markup).toContain("Your human review")
  })

  it("does not enable specialist review for a slug collision with the wrong language ID", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleReviewWorkspace, {
        assignmentId: "assignment-private",
        reviewerLanguages: [
          {
            languageId: "different-language-id",
            languageSlug: "arabic",
            languageBcp47: "ar",
            specialistAllowed: true,
          },
        ],
        initialState: readyState(),
      }),
    )

    expect(markup).not.toContain("Scripture / theology score")
    expect(markup).not.toContain("different-language-id")
  })
})
