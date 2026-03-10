import { createElement } from "react"

import type { VideoHeroSection } from "../../lib/sectionModels"
import { VideoHeroRenderer } from "./VideoHeroRenderer"

const baseSection: VideoHeroSection = {
  kind: "videoHero",
  id: "vh-1",
  sectionKey: "hero",
  heading: "Experience Easter",
  subheading: "Watch the story",
  streamingUrl: "https://example.com/video.m3u8",
  ctaLink: "https://example.com/watch",
  ctaLabel: "Watch Now",
  video: {
    documentId: "v1",
    slug: "easter-video",
    title: "Easter Video",
    image: {
      url: "https://example.com/thumb.jpg",
      alternativeText: "Easter thumbnail",
    },
  },
}

describe("VideoHeroRenderer", () => {
  it("renders without throwing with all fields", () => {
    expect(() =>
      createElement(VideoHeroRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it("renders without throwing when optional fields are null", () => {
    const minimal: VideoHeroSection = {
      ...baseSection,
      heading: null,
      subheading: null,
      streamingUrl: null,
      ctaLabel: null,
      ctaLink: null,
      video: { documentId: "v1", slug: "test", title: "Test", image: null },
    }
    expect(() =>
      createElement(VideoHeroRenderer, { section: minimal }),
    ).not.toThrow()
  })

  it("renders without throwing when only heading is present", () => {
    const headingOnly: VideoHeroSection = {
      ...baseSection,
      subheading: null,
      ctaLabel: null,
      ctaLink: null,
    }
    expect(() =>
      createElement(VideoHeroRenderer, { section: headingOnly }),
    ).not.toThrow()
  })

  it("renders without throwing when ctaLabel is present but ctaLink is null", () => {
    const noCTALink: VideoHeroSection = {
      ...baseSection,
      ctaLink: null,
    }
    expect(() =>
      createElement(VideoHeroRenderer, { section: noCTALink }),
    ).not.toThrow()
  })

  it("renders without throwing when streamingUrl is null (falls back to thumbnail)", () => {
    const noStream: VideoHeroSection = {
      ...baseSection,
      streamingUrl: null,
    }
    expect(() =>
      createElement(VideoHeroRenderer, { section: noStream }),
    ).not.toThrow()
  })
})
