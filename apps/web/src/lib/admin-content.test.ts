import { describe, expect, it } from "vitest"
import { normalizeAdminExperience } from "@/lib/admin-content"

describe("normalizeAdminExperience", () => {
  it("maps generated admin experience blocks into watch renderer blocks", () => {
    const result = normalizeAdminExperience({
      id: "loc-1",
      locale: "en",
      slug: "jesus",
      title: "Jesus",
      metaDescription: "Generated page.",
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      referencedVideos: [
        {
          id: "video-1",
          slug: "jesus-vision",
          label: "SHORT_FILM",
          locales: [
            {
              locale: "en",
              title: "Hydrated Jesus Vision",
              description: "Hydrated description",
              snippet: null,
            },
          ],
          images: [{ url: "https://images.example/hydrated.jpg" }],
          dubs: [
            {
              hls: "https://stream.example/spanish.m3u8",
              published: true,
              language: { bcp47: "es", iso3: "spa", slug: "spanish" },
            },
            {
              hls: "https://stream.example/hydrated.m3u8",
              published: true,
              language: { bcp47: "en", iso3: "eng", slug: "english" },
            },
          ],
        },
      ],
      blocks: [
        {
          t: "videoHero",
          sectionKey: "ai-s01",
          videoId: "video-1",
          heading: "Jesus Vision - John",
          subheading: "Vision image of Jesus from John",
        },
        {
          t: "mediaCollection",
          sectionKey: "ai-s02",
          title: "Featured Stories About Jesus",
          variant: "collection",
          items: [
            {
              videoId: "video-1",
              titleOverride: "What Was Jesus Really Like?",
              subtitleOverride: "A short story.",
            },
          ],
        },
        {
          t: "videoCarousel",
          sectionKey: "ai-s03",
          title: "Watch More",
          description: "A quick set of videos.",
          items: [
            {
              videoId: "video-1",
              titleOverride: "Jesus Prays to be Glorified",
            },
          ],
        },
        {
          t: "section",
          sectionKey: "ai-s04",
          backgroundColor: "dark",
          content: [
            {
              t: "text",
              sectionKey: "ai-s05",
              heading: "Reflect",
              contentParagraphs: ["A real generated paragraph."],
            },
            {
              t: "navigationCarousel",
              items: [{ contentId: "ai-s05", title: "Reflect" }],
            },
          ],
        },
        {
          t: "video",
          sectionKey: "ai-s06",
          videoId: "video-1",
        },
      ],
    })

    expect(result.blocks).toEqual([
      expect.objectContaining({
        __typename: "ComponentSectionsVideoHero",
        heading: "Jesus Vision - John",
        streamingUrl: "https://stream.example/hydrated.m3u8",
      }),
      expect.objectContaining({
        __typename: "ComponentSectionsMediaCollection",
        title: "Featured Stories About Jesus",
        mediaCollectionVariant: "collection",
        items: [
          expect.objectContaining({
            titleOverride: "What Was Jesus Really Like?",
            subtitleOverride: "A short story.",
            imageUrl: "https://images.example/hydrated.jpg",
            video: expect.objectContaining({ slug: "jesus-vision" }),
          }),
        ],
      }),
      expect.objectContaining({
        __typename: "ComponentSectionsVideoCarousel",
        title: "Watch More",
        carouselDescription: "A quick set of videos.",
        items: [
          expect.objectContaining({
            titleOverride: "Jesus Prays to be Glorified",
            streamingUrl: "https://stream.example/hydrated.m3u8",
            imageUrl: "https://images.example/hydrated.jpg",
          }),
        ],
      }),
      expect.objectContaining({
        __typename: "ComponentSectionsSection",
        sectionContent: [
          expect.objectContaining({
            __typename: "ComponentSectionsText",
            heading: "Reflect",
          }),
          expect.objectContaining({
            __typename: "ComponentSectionsNavigationCarousel",
            items: [expect.objectContaining({ contentId: "ai-s05" })],
          }),
        ],
      }),
      expect.objectContaining({
        __typename: "ComponentSectionsVideo",
        streamingUrl: "https://stream.example/hydrated.m3u8",
        title: "Hydrated Jesus Vision",
        subtitle: "Hydrated description",
      }),
    ])
  })

  it("drops unsupported generated blocks without dropping the whole page", () => {
    const result = normalizeAdminExperience({
      id: "loc-1",
      locale: "en",
      slug: "jesus",
      title: "Jesus",
      metaDescription: "Generated page.",
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      referencedVideos: [],
      blocks: [
        { t: "unknown", title: "Ignore me" },
        { t: "text", heading: "Keep this", contentParagraphs: ["Hello"] },
      ],
    })

    expect(result.blocks).toHaveLength(1)
    expect(result.blocks?.[0]).toEqual(
      expect.objectContaining({ __typename: "ComponentSectionsText" }),
    )
  })

  it("does not hydrate preview streams from another language", () => {
    const result = normalizeAdminExperience({
      id: "loc-1",
      locale: "en",
      slug: "jesus",
      title: "Jesus",
      metaDescription: "Generated page.",
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      referencedVideos: [
        {
          id: "video-1",
          slug: "jesus-vision",
          label: "SHORT_FILM",
          locales: [
            {
              locale: "en",
              title: "Hydrated Jesus Vision",
              description: "Hydrated description",
              snippet: null,
            },
          ],
          images: [],
          dubs: [
            {
              hls: "https://stream.example/spanish.m3u8",
              published: true,
              language: { bcp47: "es", iso3: "spa", slug: "spanish" },
            },
          ],
        },
      ],
      blocks: [{ t: "videoHero", videoId: "video-1", heading: "Jesus" }],
    })

    expect(result.blocks?.[0]).toEqual(
      expect.objectContaining({
        __typename: "ComponentSectionsVideoHero",
        streamingUrl: null,
      }),
    )
  })
})
