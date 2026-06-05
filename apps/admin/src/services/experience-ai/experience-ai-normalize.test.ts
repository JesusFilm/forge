import { describe, expect, it } from "vitest"
import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
} from "./experience-ai-normalize"
import type { DraftExperience, VideoCandidate } from "./experience-ai.schemas"

const candidates: VideoCandidate[] = [
  {
    ref: "v01",
    videoId: "video-1",
    slug: "forgiven",
    title: "Forgiven",
    description: "A story about forgiveness.",
    previewImageUrl: "https://example.com/forgiven.jpg",
    previewStreamUrl: "https://example.com/forgiven.m3u8",
    label: "FEATURE_FILM",
  },
  {
    ref: "v02",
    videoId: "video-2",
    slug: "freedom",
    title: "Freedom",
    description: "A story about freedom.",
    previewImageUrl: "https://example.com/freedom.jpg",
    previewStreamUrl: "https://example.com/freedom.m3u8",
    label: "SHORT_FILM",
  },
]

describe("normalizeExperienceDraft", () => {
  it("normalizes candidate refs and section refs into admin blocks", () => {
    const draft: DraftExperience = {
      title: "Forgiven and Free",
      metaDescription: "A guided story about forgiveness and freedom.",
      blocks: [
        {
          t: "videoHero",
          sectionRef: "s01",
          candidateRef: "v01",
          heading: "Watch the story",
        },
        {
          t: "section",
          sectionRef: "s02",
          content: [
            {
              t: "text",
              sectionRef: "s03",
              heading: "You are not alone",
              contentParagraphs: ["Grace meets us where we are."],
            },
            {
              t: "video",
              sectionRef: "s04",
              candidateRef: "v01",
              titleSource: "manual",
              title: "Watch the story",
            },
          ],
        },
        {
          t: "navigationCarousel",
          items: [
            {
              targetRef: "s02",
              title: "Start here",
            },
          ],
        },
        {
          t: "mediaCollection",
          title: "Keep exploring",
          variant: "collection",
          items: [
            {
              candidateRef: "v02",
              targetRef: "s02",
            },
          ],
        },
      ],
    }

    const normalized = normalizeExperienceDraft(draft, candidates)

    expect(normalized.title).toBe("Forgiven and Free")
    expect(normalized.blocks[0]).toMatchObject({
      t: "videoHero",
      sectionKey: "ai-s01",
    })
    expect(normalized.blocks[1]).toMatchObject({
      t: "section",
      sectionKey: "ai-s02",
    })
    expect(normalized.blocks[2]).toMatchObject({
      t: "navigationCarousel",
      items: [{ contentId: "ai-s02" }],
    })
    expect(normalized.blocks[3]).toMatchObject({
      t: "mediaCollection",
      items: [{ videoId: "video-2", linkToSectionKey: "ai-s02" }],
    })
  })

  it("flattens container slots into containerSlot markers plus nested content", () => {
    const draft: DraftExperience = {
      title: "Two Column Story",
      metaDescription: "A two-column story.",
      blocks: [
        {
          t: "container",
          sectionRef: "s01",
          slots: [
            {
              gridSpan: 7,
              content: [{ t: "text", heading: "Column one" }],
            },
            {
              gridSpan: 5,
              content: [{ t: "video", candidateRef: "v01" }],
            },
          ],
        },
      ],
    }

    const normalized = normalizeExperienceDraft(draft, candidates)
    expect(normalized.blocks[0]).toMatchObject({
      t: "container",
      sectionKey: "ai-s01",
      content: [
        { t: "containerSlot", gridSpan: 7 },
        { t: "text", heading: "Column one" },
        { t: "containerSlot", gridSpan: 5 },
        { t: "video", videoId: "video-1" },
      ],
    })
  })

  it("fails on unknown video refs", () => {
    const draft: DraftExperience = {
      title: "Unknown",
      metaDescription: "Unknown",
      blocks: [{ t: "video", candidateRef: "v99" }],
    }

    expect(() => normalizeExperienceDraft(draft, candidates)).toThrowError(
      ExperienceAiNormalizationError,
    )
  })

  it("repairs duplicate section refs with unique section keys", () => {
    const draft: DraftExperience = {
      title: "Duplicate refs",
      metaDescription: "Duplicate refs",
      blocks: [
        { t: "text", sectionRef: "s01", heading: "One" },
        { t: "text", sectionRef: "s01", heading: "Two" },
      ],
    }

    const normalized = normalizeExperienceDraft(draft, candidates)
    expect(normalized.blocks).toMatchObject([
      { t: "text", sectionKey: "ai-s01", heading: "One" },
      { t: "text", sectionKey: "ai-s01-1", heading: "Two" },
    ])
  })

  describe("presentation defaults", () => {
    it("fills hero clip seconds with 0/8 when both are omitted", () => {
      const draft: DraftExperience = {
        title: "Hero defaults",
        metaDescription: "Hero defaults",
        blocks: [
          {
            t: "videoHero",
            sectionRef: "s01",
            candidateRef: "v01",
          },
          {
            t: "text",
            sectionRef: "s02",
            heading: "Body",
            contentParagraphs: ["copy"],
          },
        ],
      }

      const normalized = normalizeExperienceDraft(draft, candidates)
      expect(normalized.blocks[0]).toMatchObject({
        t: "videoHero",
        clipStartSeconds: 0,
        clipEndSeconds: 8,
      })
    })

    it("preserves an explicit hero clipStartSeconds without defaulting clipEndSeconds", () => {
      const draft: DraftExperience = {
        title: "Hero start only",
        metaDescription: "Hero start only",
        blocks: [
          {
            t: "videoHero",
            sectionRef: "s01",
            candidateRef: "v01",
            clipStartSeconds: 5,
          },
          {
            t: "text",
            sectionRef: "s02",
            heading: "Body",
            contentParagraphs: ["copy"],
          },
        ],
      }

      const normalized = normalizeExperienceDraft(draft, candidates)
      expect(normalized.blocks[0]).toMatchObject({
        t: "videoHero",
        clipStartSeconds: 5,
      })
      expect(normalized.blocks[0]).not.toHaveProperty("clipEndSeconds")
    })

    it("fills section dynamicBackgroundImage and backgroundOpacity when first video-bearing nested block has previewImageUrl", () => {
      const draft: DraftExperience = {
        title: "Section bg",
        metaDescription: "Section bg",
        blocks: [
          {
            t: "videoHero",
            sectionRef: "s01",
            candidateRef: "v01",
          },
          {
            t: "section",
            sectionRef: "s02",
            content: [
              {
                t: "text",
                heading: "Intro",
                contentParagraphs: ["copy"],
              },
              {
                t: "video",
                candidateRef: "v01",
              },
            ],
          },
        ],
      }

      const normalized = normalizeExperienceDraft(draft, candidates)
      expect(normalized.blocks[1]).toMatchObject({
        t: "section",
        dynamicBackgroundImage: true,
        backgroundOpacity: 0.65,
      })
    })

    it("preserves explicit dynamicBackgroundImage: false even when candidate previewImageUrl is present", () => {
      const draft: DraftExperience = {
        title: "Explicit false",
        metaDescription: "Explicit false",
        blocks: [
          {
            t: "videoHero",
            sectionRef: "s01",
            candidateRef: "v01",
          },
          {
            t: "section",
            sectionRef: "s02",
            dynamicBackgroundImage: false,
            content: [
              {
                t: "video",
                candidateRef: "v01",
              },
            ],
          },
        ],
      }

      const normalized = normalizeExperienceDraft(draft, candidates)
      expect(normalized.blocks[1]).toMatchObject({
        t: "section",
        dynamicBackgroundImage: false,
      })
      expect(normalized.blocks[1]).not.toHaveProperty("backgroundOpacity")
    })

    it("does not fill section dynamicBackgroundImage when candidate previewImageUrl is missing", () => {
      const candidatesWithoutPreview: VideoCandidate[] = [
        {
          ref: "v01",
          videoId: "video-1",
          slug: "no-preview",
          title: "No preview",
          description: null,
          previewImageUrl: null,
          previewStreamUrl: null,
          label: null,
        },
      ]
      const draft: DraftExperience = {
        title: "No preview",
        metaDescription: "No preview",
        blocks: [
          {
            t: "videoHero",
            sectionRef: "s01",
            candidateRef: "v01",
          },
          {
            t: "section",
            sectionRef: "s02",
            content: [
              {
                t: "video",
                candidateRef: "v01",
              },
            ],
          },
        ],
      }

      const normalized = normalizeExperienceDraft(
        draft,
        candidatesWithoutPreview,
      )
      expect(normalized.blocks[1]).toMatchObject({
        t: "section",
        dynamicBackgroundImage: false,
      })
      expect(normalized.blocks[1]).not.toHaveProperty("backgroundOpacity")
    })

    it("fills container slot spans with balanced layout when omitted (3 slots → md:4)", () => {
      const draft: DraftExperience = {
        title: "Three slots",
        metaDescription: "Three slots",
        blocks: [
          {
            t: "videoHero",
            sectionRef: "s00",
            candidateRef: "v01",
          },
          {
            t: "container",
            sectionRef: "s01",
            slots: [
              { content: [{ t: "text", heading: "One" }] },
              { content: [{ t: "text", heading: "Two" }] },
              { content: [{ t: "text", heading: "Three" }] },
            ],
          },
        ],
      }

      const normalized = normalizeExperienceDraft(draft, candidates)
      const container = normalized.blocks[1] as {
        t: "container"
        content: Array<{ t: string; spans?: { md?: number } }>
      }
      const slotMarkers = container.content.filter(
        (entry) => entry.t === "containerSlot",
      )
      expect(slotMarkers).toHaveLength(3)
      slotMarkers.forEach((marker) => {
        expect(marker.spans).toEqual({ md: 4 })
      })
    })

    it("only fills omitted slot spans, leaving model-set spans untouched (2 slots)", () => {
      const draft: DraftExperience = {
        title: "Mixed slots",
        metaDescription: "Mixed slots",
        blocks: [
          {
            t: "videoHero",
            sectionRef: "s00",
            candidateRef: "v01",
          },
          {
            t: "container",
            sectionRef: "s01",
            slots: [
              {
                spans: { md: 8 },
                content: [{ t: "text", heading: "Wide" }],
              },
              {
                content: [{ t: "text", heading: "Narrow" }],
              },
            ],
          },
        ],
      }

      const normalized = normalizeExperienceDraft(draft, candidates)
      const container = normalized.blocks[1] as {
        t: "container"
        content: Array<{ t: string; spans?: { md?: number } }>
      }
      const slotMarkers = container.content.filter(
        (entry) => entry.t === "containerSlot",
      )
      expect(slotMarkers).toHaveLength(2)
      expect(slotMarkers[0]?.spans).toEqual({ md: 8 })
      expect(slotMarkers[1]?.spans).toEqual({ md: 6 })
    })
  })
})
