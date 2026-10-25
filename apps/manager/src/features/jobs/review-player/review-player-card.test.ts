import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ReviewPlayerCard } from "@/features/jobs/review-player/review-player-card"
import type { JobReviewContextResult } from "@/features/jobs/review-player/review-player-types"
import type { JobRecord } from "@/types/job"

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

function buildJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: [],
    sourceLanguageCode: "en",
    primaryRequestedTargetLanguageCode: "en",
    resolvedTargetLanguageCodes: ["en"],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:01:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

function buildReadyContext(): JobReviewContextResult {
  return {
    status: "ready",
    context: {
      playbackUrl: "https://stream.mux.com/playback-1.m3u8",
      before: {
        subtitles: {
          status: "available",
          tracks: [
            {
              languageCode: "en",
              label: "EN",
              src: "https://stream.mux.com/playback-1/text/track-en.vtt",
              source: "mux",
              isGenerated: false,
            },
          ],
        },
        metadata: {
          status: "available",
          value: {
            title: "Live title",
            description: "Live description",
          },
        },
        chapters: {
          status: "unavailable",
          reason: "no_live_chapters",
        },
      },
      after: {
        subtitles: {
          status: "available",
          tracks: [
            {
              languageCode: "en",
              label: "EN",
              src: "/api/jobs/job-1/artifacts/subtitles-en",
              source: "artifact",
              isGenerated: true,
            },
          ],
        },
        metadata: {
          status: "available",
          value: {
            title: "Generated title",
            description: "Generated description",
          },
        },
        chapters: {
          status: "available",
          value: {
            chapters: [
              {
                title: "Opening",
                startSeconds: 0,
                endSeconds: 42,
              },
            ],
          },
        },
      },
      compare: {},
    },
  }
}

describe("ReviewPlayerCard", () => {
  it("keeps review mode and subtitle track labels out of the player chrome", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReviewPlayerCard, {
        job: buildJobRecord(),
        reviewContext: buildReadyContext(),
      }),
    )

    expect(markup).toContain("Review Player")
    expect(markup).toContain("Before")
    expect(markup).toContain("After")
    expect(markup).toContain("jobs-review-video")
    expect(markup).toContain("Generated title")
    expect(markup).not.toContain("Generated output")
    expect(markup).not.toContain("EN subtitles")
  })
})
