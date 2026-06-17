import { describe, expect, it } from "vitest"

import { parseYouTubeVideo } from "./post-parser"
import type { YouTubeRawItem } from "./types"

const searchItem: YouTubeRawItem = {
  id: { videoId: "abc123" },
  snippet: {
    title: "AI film of Jesus #aiart",
    description: "Made with Veo. #faith #aivideo",
    channelId: "UC_grace",
    channelTitle: "Grace Films",
    publishedAt: "2026-06-01T12:00:00Z",
    thumbnails: {
      default: { url: "https://i.ytimg.com/default.jpg" },
      high: { url: "https://i.ytimg.com/high.jpg" },
    },
  },
}

const playlistItem: YouTubeRawItem = {
  contentDetails: { videoId: "xyz789" },
  snippet: {
    title: "Prodigal son, AI animated",
    description: "A cinematic retelling.",
    channelId: "UC_grace",
    channelTitle: "Grace Films",
    publishedAt: "2026-06-02T08:00:00Z",
    resourceId: { videoId: "xyz789" },
  },
}

describe("parseYouTubeVideo", () => {
  it("parses a search.list item into a normalized video", () => {
    const video = parseYouTubeVideo(searchItem)
    expect(video).not.toBeNull()
    expect(video!.videoId).toBe("abc123")
    expect(video!.url).toBe("https://www.youtube.com/watch?v=abc123")
    expect(video!.authorUrl).toBe("https://www.youtube.com/channel/UC_grace")
    expect(video!.channelTitle).toBe("Grace Films")
    expect(video!.publishedAt).toBe("2026-06-01T12:00:00Z")
  })

  it("parses a playlistItems.list item (resourceId shape)", () => {
    const video = parseYouTubeVideo(playlistItem)
    expect(video!.videoId).toBe("xyz789")
    expect(video!.url).toBe("https://www.youtube.com/watch?v=xyz789")
  })

  it("prefers the highest-resolution thumbnail available", () => {
    const video = parseYouTubeVideo(searchItem)
    expect(video!.thumbnailUrl).toBe("https://i.ytimg.com/high.jpg")
  })

  it("extracts hashtags from the description", () => {
    const video = parseYouTubeVideo(searchItem)
    expect(video!.hashtags).toContain("#faith")
    expect(video!.hashtags).toContain("#aivideo")
  })

  it("returns empty hashtags when the description has none", () => {
    const video = parseYouTubeVideo(playlistItem)
    expect(video!.hashtags).toEqual([])
  })

  it("returns null when no video id can be resolved", () => {
    const video = parseYouTubeVideo({ snippet: { title: "no id" } })
    expect(video).toBeNull()
  })

  it("caps an over-long description to the schema bound", () => {
    const video = parseYouTubeVideo({
      id: { videoId: "long1" },
      snippet: { title: "t", description: "x".repeat(5000) },
    })
    expect(video!.description.length).toBeLessThanOrEqual(1024)
  })

  it("leaves matched arrays empty for the classifier to fill", () => {
    const video = parseYouTubeVideo(searchItem)
    expect(video!.matchedAi).toEqual([])
    expect(video!.matchedChristian).toEqual([])
  })
})
