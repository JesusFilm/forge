import { describe, expect, it } from "vitest"
import { BlocksSchema } from "@/domain/blocks"
import { stripRetiredBlockVisualUrls } from "./experience-persisted-blocks"

function mediaCollection(item: Record<string, unknown>) {
  return {
    t: "mediaCollection",
    variant: "collection",
    itemsSource: "manual",
    showItemNumbers: false,
    items: [item],
  }
}

describe("stripRetiredBlockVisualUrls", () => {
  it("removes retired imageUrl and backgroundImageUrl keys at any depth", () => {
    const stale = [
      mediaCollection({
        videoId: "video-1",
        imageUrl: "https://cdn.example.com/old.jpg",
        imageAssetId: "asset-1",
      }),
      {
        t: "section",
        sectionKey: "hero",
        backgroundImageUrl: "https://cdn.example.com/bg.jpg",
        backgroundImageAssetId: "asset-bg",
        content: [],
      },
    ]

    const cleaned = stripRetiredBlockVisualUrls(stale)

    expect(cleaned).toEqual([
      mediaCollection({ videoId: "video-1", imageAssetId: "asset-1" }),
      {
        t: "section",
        sectionKey: "hero",
        backgroundImageAssetId: "asset-bg",
        content: [],
      },
    ])
    expect(BlocksSchema.safeParse(cleaned).success).toBe(true)
  })

  it("does not mutate its input", () => {
    const stale = [
      mediaCollection({ videoId: "video-1", imageUrl: "/old.jpg" }),
    ]
    const snapshot = structuredClone(stale)

    stripRetiredBlockVisualUrls(stale)

    expect(stale).toEqual(snapshot)
  })

  it("keeps legitimate mediaUrl and every other field byte-for-byte", () => {
    const current = [
      {
        t: "cta",
        sectionKey: "cta",
        mediaUrl: "https://cdn.example.com/video.mp4",
        heading: "Watch",
      },
    ]

    expect(stripRetiredBlockVisualUrls(current)).toEqual(current)
  })

  it("passes non-object values through unchanged", () => {
    expect(stripRetiredBlockVisualUrls(null)).toBeNull()
    expect(stripRetiredBlockVisualUrls("text")).toBe("text")
    expect(stripRetiredBlockVisualUrls(3)).toBe(3)
  })

  it("leaves the current write schema strict about raw image URLs", () => {
    const withRawUrl = [
      mediaCollection({ videoId: "video-1", imageUrl: "/new.jpg" }),
    ]

    expect(BlocksSchema.safeParse(withRawUrl).success).toBe(false)
    // Only the persisted-read helper sanitizes; it is not part of the schema.
    expect(
      BlocksSchema.safeParse(stripRetiredBlockVisualUrls(withRawUrl)).success,
    ).toBe(true)
  })
})
