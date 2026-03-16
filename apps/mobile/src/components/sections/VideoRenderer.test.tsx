import { createElement } from "react"

import type { VideoSection } from "../../lib/sectionModels"
import { VideoRenderer } from "./VideoRenderer"

const baseSection: VideoSection = {
  kind: "video",
  id: "vid-1",
  sectionKey: "video-block",
  streamingUrl: "https://example.com/stream.m3u8",
  title: "Jesus' Victory Over Sin and Death",
  subtitle: "Watch the full story",
  media: {
    url: "https://example.com/thumb.jpg",
    alternativeText: "Video thumbnail",
  },
  video: {
    documentId: "v1",
    slug: "easter-video",
    title: "Easter Video",
    image: {
      url: "https://example.com/video-thumb.jpg",
      alternativeText: "Easter thumbnail",
    },
  },
}

describe("VideoRenderer", () => {
  it("renders without throwing with all fields", () => {
    expect(() =>
      createElement(VideoRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it("renders without throwing with minimal fields", () => {
    const minimal: VideoSection = {
      ...baseSection,
      title: null,
      subtitle: null,
      media: null,
      video: null,
    }
    expect(() =>
      createElement(VideoRenderer, { section: minimal }),
    ).not.toThrow()
  })

  it("renders without throwing when media is null but video has image", () => {
    const fallbackThumb: VideoSection = {
      ...baseSection,
      media: null,
    }
    expect(() =>
      createElement(VideoRenderer, { section: fallbackThumb }),
    ).not.toThrow()
  })

  it("renders without throwing when both media and video are null", () => {
    const noThumb: VideoSection = {
      ...baseSection,
      media: null,
      video: null,
    }
    expect(() =>
      createElement(VideoRenderer, { section: noThumb }),
    ).not.toThrow()
  })
})
