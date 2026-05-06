import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SelectedVideoStack } from "@/features/coverage/coverage-report-client"
import type { ClientVideo } from "@/features/coverage/coverage-report-model"

function video(overrides: Partial<ClientVideo> = {}): ClientVideo {
  return {
    id: "video-1",
    title: "Day 35: The Trial",
    imageUrl: "https://example.test/thumb.jpg",
    muxAssetId: "mux-asset-1",
    muxPlaybackId: "mux-playback-1",
    status: "completed",
    languages: [],
    steps: [],
    errors: [],
    artifacts: {},
    coverageStatus: "none",
    coverageCounts: { human: 0, ai: 0, none: 1 },
    stepCompleteness: { completed: 0, total: 0 },
    ...overrides,
  }
}

describe("SelectedVideoStack", () => {
  it("renders nothing when no videos are selected", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SelectedVideoStack, { videos: [] }),
    )

    expect(markup).toBe("")
  })

  it("renders a fallback initial when a selected video has no image", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SelectedVideoStack, {
        videos: [video({ id: "video-empty", imageUrl: null, title: "Trial" })],
      }),
    )

    expect(markup).toContain("selected-video-stack-thumb")
    expect(markup).toContain(">T</span>")
  })

  it("renders up to four thumbnails with an overflow count", () => {
    const videos = Array.from({ length: 6 }, (_, index) =>
      video({
        id: `video-${index + 1}`,
        title: `Video ${index + 1}`,
      }),
    )

    const markup = renderToStaticMarkup(
      React.createElement(SelectedVideoStack, { videos }),
    )

    expect(markup.match(/selected-video-stack-thumb/g)).toHaveLength(4)
    expect(markup).toContain("selected-video-stack-overflow")
    expect(markup).toContain("+2")
  })
})
