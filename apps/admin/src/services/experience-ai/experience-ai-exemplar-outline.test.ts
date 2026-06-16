import { describe, expect, it } from "vitest"
import { buildExemplarOutline } from "./experience-ai-exemplar-outline"

// A realistic stored-blocks shape (videoId-bearing, like a published page).
const EASTER_LIKE_BLOCKS = [
  {
    t: "videoHero",
    sectionKey: "s01",
    videoId: "vid-easter-hero-001",
    streamingUrl: "https://stream.example/easter.m3u8",
    heading: "He is risen",
    subheading: "The Easter story, in his own words.",
    autoplay: true,
    muted: false,
    clipStartSeconds: 0,
  },
  {
    t: "section",
    sectionKey: "s02",
    backgroundColor: "#112233",
    content: [
      {
        t: "mediaCollection",
        variant: "collection",
        title: "The bigger picture",
        items: [
          {
            videoId: "vid-002",
            titleOverride: "Why did Jesus die?",
            imageOverrideUrl: "https://img.example/2.jpg",
          },
          { videoId: "vid-003", titleOverride: "Did he rise?" },
        ],
      },
    ],
  },
  {
    t: "section",
    sectionKey: "s03",
    content: [
      {
        t: "bibleQuotesCarousel",
        heading: "Scripture",
        quotes: [{ reference: "John 20:19", text: "Peace be with you." }],
      },
    ],
  },
]

describe("buildExemplarOutline", () => {
  it("preserves block kinds and copy in document order", () => {
    const outline = buildExemplarOutline({
      title: "Easter",
      metaDescription: "The Easter story.",
      blocks: EASTER_LIKE_BLOCKS,
    })
    expect(outline).not.toBeNull()
    const parsed = JSON.parse(outline!)
    expect(parsed.title).toBe("Easter")
    expect(parsed.blocks.map((b: { t: string }) => b.t)).toEqual([
      "videoHero",
      "section",
      "section",
    ])
    // Copy is retained as a voice reference.
    expect(outline).toContain("He is risen")
    expect(outline).toContain("Peace be with you.")
    // Nesting is preserved.
    expect(parsed.blocks[1].content[0].t).toBe("mediaCollection")
    expect(parsed.blocks[1].content[0].items[0].titleOverride).toBe(
      "Why did Jesus die?",
    )
  })

  it("strips every video id, streaming/image url, and colour (R8)", () => {
    const outline = buildExemplarOutline({
      title: "Easter",
      metaDescription: null,
      blocks: EASTER_LIKE_BLOCKS,
    })!
    expect(outline).not.toContain("vid-easter-hero-001")
    expect(outline).not.toContain("vid-002")
    expect(outline).not.toContain("vid-003")
    expect(outline).not.toContain("stream.example")
    expect(outline).not.toContain("img.example")
    expect(outline).not.toContain("#112233")
    // And the keys themselves are gone.
    expect(outline).not.toContain("videoId")
    expect(outline).not.toContain("streamingUrl")
    expect(outline).not.toContain("backgroundColor")
  })

  it("drops boolean/number config noise but keeps the discriminator", () => {
    const outline = buildExemplarOutline({
      blocks: EASTER_LIKE_BLOCKS,
    })!
    expect(outline).not.toContain("autoplay")
    expect(outline).not.toContain("clipStartSeconds")
    expect(outline).toContain('"t":"videoHero"')
  })

  it("truncates an oversized page to the block cap with a marker", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      t: "section",
      sectionKey: `s${i}`,
      content: [
        { t: "text", heading: `Section ${i}`, contentParagraphs: ["body"] },
      ],
    }))
    const outline = buildExemplarOutline({ title: "Big", blocks: many })!
    const parsed = JSON.parse(outline)
    // 12 real sections + 1 truncation marker string
    expect(parsed.blocks.length).toBe(13)
    expect(parsed.blocks[12]).toContain("more sections")
  })

  it("strips EVERY known video/asset/url/contentId field name (R8 schema-coverage guard)", () => {
    // Enumerates the reference-leaking field names present across the
    // block schema (src/domain/blocks.ts). Each carries a unique sentinel;
    // none may appear in the outline. Guards R8 against a DROP_KEY regex
    // change. If a new reference field is added to blocks.ts under a name
    // not covered here, add it to this list.
    const sentinels: Record<string, string> = {
      videoId: "LEAK-videoId",
      sourceVideoId: "LEAK-sourceVideoId",
      streamingUrl: "LEAK-streamingUrl",
      previewStreamUrl: "LEAK-previewStreamUrl",
      imageUrl: "LEAK-imageUrl",
      imageOverrideUrl: "LEAK-imageOverrideUrl",
      imageAssetId: "LEAK-imageAssetId",
      imageOverrideAssetId: "LEAK-imageOverrideAssetId",
      playbackId: "LEAK-playbackId",
      iframeSrc: "LEAK-iframeSrc",
      contentId: "LEAK-contentId",
      ctaLink: "LEAK-ctaLink",
      backgroundColor: "LEAK-backgroundColor",
      hls: "LEAK-hls",
      dash: "LEAK-dash",
    }
    const outline = buildExemplarOutline({
      title: "Cov",
      blocks: [
        { t: "videoHero", heading: "keep me", ...sentinels },
        {
          t: "section",
          content: [
            {
              t: "navigationCarousel",
              items: [{ title: "nav", ...sentinels }],
            },
          ],
        },
      ],
    })!
    for (const value of Object.values(sentinels)) {
      expect(outline).not.toContain(value)
    }
    // The structural / copy content still survives.
    expect(outline).toContain("keep me")
    expect(outline).toContain("nav")
  })

  it("keeps the final serialized string within the byte cap including the marker", () => {
    // 12 blocks (the top-level cap) each with several long paragraphs —
    // well over the 4000-char serialized budget so truncation fires.
    const huge = Array.from({ length: 12 }, (_, i) => ({
      t: "text",
      heading: `H${i}`,
      contentParagraphs: Array.from({ length: 6 }, () => "x".repeat(290)),
    }))
    const outline = buildExemplarOutline({
      title: "y".repeat(290),
      metaDescription: "z".repeat(290),
      blocks: huge,
    })!
    expect(outline.length).toBeLessThanOrEqual(4000)
    expect(outline.endsWith("…(truncated)")).toBe(true)
  })

  it("returns null for an empty page", () => {
    expect(buildExemplarOutline({ blocks: [] })).toBeNull()
    expect(buildExemplarOutline({ blocks: "not an array" })).toBeNull()
  })

  it("walks malformed/partial blocks without throwing", () => {
    const outline = buildExemplarOutline({
      blocks: [
        { t: "videoHero", heading: "ok" },
        { weird: { nested: "value" } },
        null,
        42,
      ],
    })
    expect(outline).not.toBeNull()
    expect(outline).toContain("ok")
  })
})
