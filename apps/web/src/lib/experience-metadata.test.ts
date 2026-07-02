import { afterEach, describe, expect, it, vi } from "vitest"

const { resolveWatchPageMock } = vi.hoisted(() => ({
  resolveWatchPageMock: vi.fn(),
}))

vi.mock("@/lib/content", () => ({
  resolveWatchPage: resolveWatchPageMock,
  experienceToMetadata: vi.fn(),
}))

describe("getWatchPageMetadata", () => {
  afterEach(() => {
    resolveWatchPageMock.mockReset()
    vi.resetModules()
  })

  it("uses route video metadata for template-backed watch pages", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "video-template",
        template: {
          documentId: "exp-template-1",
          slug: "single-video",
        },
        routeVideo: {
          documentId: "video-1",
          slug: "jesus",
          title: "Jesus",
          snippet: "The story of Jesus",
          description: "Longer description",
          noIndex: true,
          imageUrl: "https://cdn.example/jesus.jpg",
          imageAlt: "Jesus still",
          streamingUrl: "https://cdn.example/jesus.m3u8",
          relatedItems: [],
        },
      },
      error: null,
    })

    const { getWatchPageMetadata } = await import("./experience-metadata")

    const metadata = await getWatchPageMetadata("en", {
      slug: "jesus",
    })

    // Title always appends the brand suffix on the video-template branch
    // (previously the suffix only fired when routeVideo.title was empty).
    expect(metadata.title).toBe("Jesus | Jesus Film Project")
    // Description prefers the longer `description` field over the punchier
    // `snippet` for SEO (Google likes 120–160 chars). Snippet is the fallback.
    expect(metadata.description).toBe("Longer description")
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/jesus.html",
    )
    expect(metadata.openGraph).toMatchObject({
      title: "Jesus | Jesus Film Project",
      description: "Longer description",
      locale: "en_US",
      images: [
        {
          url: "https://cdn.example/jesus.jpg",
          alt: "Jesus still",
        },
      ],
    })
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it("falls back to snippet when description is null", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "video-template",
        template: { documentId: "exp-template-2", slug: "snippet-only" },
        routeVideo: {
          documentId: "video-2",
          slug: "snippet-only",
          title: "Snippet Only",
          snippet: "Just a snippet",
          description: null,
          noIndex: false,
          imageUrl: null,
          imageAlt: null,
          streamingUrl: null,
          relatedItems: [],
        },
      },
      error: null,
    })

    const { getWatchPageMetadata } = await import("./experience-metadata")
    const metadata = await getWatchPageMetadata("en", {
      slug: "snippet-only",
    })

    expect(metadata.description).toBe("Just a snippet")
    // robots default is explicit index/follow when noIndex is false (new
    // behaviour from this diff — was previously absent when noIndex=false).
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it("generates resolved video metadata with Twitter parity and no page-head hreflang", async () => {
    const { generateWatchVideoMetadata } = await import("./experience-metadata")
    const selectedVariant = {
      documentId: "dub-en",
      slug: null,
      published: true,
      hls: "https://cdn.example/jesus-en.m3u8",
      duration: 7200,
      language: {
        slug: "english",
        bcp47: "en",
        coreId: "529",
        name: "English",
        nativeName: "English",
      },
      downloads: [],
      muxVideo: { playbackId: "mux-en" },
    }

    const metadata = generateWatchVideoMetadata("en", {
      routeSlug: "life-of-jesus-gospel-of-john",
      pathLocale: "english",
      selectedVariant,
      video: {
        documentId: "video-1",
        slug: "life-of-jesus-gospel-of-john",
        publishedAt: "2026-06-01T12:00:00.000Z",
        title: "Life of Jesus (Gospel of John)",
        snippet: "A feature film about Jesus.",
        description: "Watch the life of Jesus from the Gospel of John.",
        noIndex: false,
        label: "featureFilm",
        imageAlt: "Jesus speaks to a crowd",
        images: [
          {
            documentId: "img-1",
            url: "https://bad.example/raw",
            thumbnail: "https://cdn.example/thumb.jpg",
            mobileCinematicHigh: "https://cdn.example/still-high.jpg",
            mobileCinematicLow: "https://cdn.example/still-low.jpg",
          },
        ],
        primaryLanguage: null,
        parents: [],
        children: [],
        childDubLanguages: [],
        variants: [
          selectedVariant,
          {
            ...selectedVariant,
            documentId: "dub-es",
            language: {
              slug: "spanish-castilian",
              bcp47: "es",
              coreId: "21028",
              name: "Spanish, Castilian",
              nativeName: "Espanol",
            },
          },
          {
            ...selectedVariant,
            documentId: "dub-es-duplicate",
            language: {
              slug: "spanish-latin-american",
              bcp47: "es",
              coreId: "21046",
              name: "Spanish, Latin American",
              nativeName: "Espanol",
            },
          },
          {
            ...selectedVariant,
            documentId: "dub-no-tag",
            language: {
              slug: "aari",
              bcp47: null,
              coreId: "1",
              name: "Aari",
              nativeName: "Aari",
            },
          },
        ],
        subtitles: [],
        studyQuestions: [],
        bibleCitations: [],
      },
    })

    expect(metadata.title).toBe(
      "Life of Jesus (Gospel of John) | Jesus Film Project",
    )
    expect(metadata.openGraph).toMatchObject({
      title: "Life of Jesus (Gospel of John) | Jesus Film Project",
      url: "https://www.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html/english.html",
      images: [
        {
          url: "https://image.mux.com/mux-en/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
          width: 1200,
          height: 630,
          alt: "Jesus speaks to a crowd",
        },
      ],
    })
    expect(metadata.twitter).toMatchObject({
      title: "Life of Jesus (Gospel of John) | Jesus Film Project",
      description: "Watch the life of Jesus from the Gospel of John.",
      images: [
        {
          url: "https://image.mux.com/mux-en/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
          alt: "Jesus speaks to a crowd",
        },
      ],
    })
    expect(metadata.alternates).toMatchObject({
      canonical:
        "https://www.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html/english.html",
    })
    expect(metadata.alternates).not.toHaveProperty("languages")
  })

  it("keeps contextual collection routes canonicalized to the standalone video URL", async () => {
    const { generateWatchVideoMetadata } = await import("./experience-metadata")
    const selectedVariant = {
      documentId: "dub-en",
      slug: null,
      published: true,
      hls: "https://cdn.example/pilate-en.m3u8",
      duration: 180,
      language: {
        slug: "english",
        bcp47: "en",
        coreId: "529",
        name: "English",
        nativeName: "English",
      },
      downloads: [],
      muxVideo: { playbackId: "mux-pilate" },
    }

    const metadata = generateWatchVideoMetadata("en", {
      routeSlug: "jesus-is-brought-to-pilate",
      pathLocale: "english",
      seriesSlug: "jesus",
      selectedVariant,
      video: {
        documentId: "video-pilate",
        slug: "jesus-is-brought-to-pilate",
        publishedAt: null,
        title: "Jesus is Brought to Pilate",
        snippet: "Pilate questions Jesus.",
        description: "Pilate questions Jesus before the crowd.",
        noIndex: false,
        label: "clip",
        imageAlt: "Jesus before Pilate",
        images: [],
        primaryLanguage: null,
        parents: [],
        children: [],
        childDubLanguages: [],
        variants: [selectedVariant],
        subtitles: [],
        studyQuestions: [],
        bibleCitations: [],
      },
    })

    const canonical =
      "https://www.jesusfilm.org/watch/jesus-is-brought-to-pilate.html/english.html"
    expect(metadata.alternates?.canonical).toBe(canonical)
    expect(metadata.openGraph).toMatchObject({ url: canonical })
    expect(metadata.alternates).not.toHaveProperty("languages")
  })

  it("uses a 1200x630 Mux social thumbnail before the generic image for playable videos", async () => {
    const { generateWatchVideoMetadata } = await import("./experience-metadata")
    const selectedVariant = {
      documentId: "dub-en",
      slug: null,
      published: true,
      hls: "https://cdn.example/jesus-en.m3u8",
      duration: null,
      language: {
        slug: "english",
        bcp47: "en",
        coreId: "529",
        name: "English",
        nativeName: "English",
      },
      downloads: [],
      muxVideo: { playbackId: "mux-playback-id" },
    }

    const metadata = generateWatchVideoMetadata("en", {
      routeSlug: "jesus",
      pathLocale: "english",
      selectedVariant,
      video: {
        documentId: "video-1",
        slug: "jesus",
        publishedAt: null,
        title: "Jesus",
        snippet: null,
        description: null,
        noIndex: false,
        label: "featureFilm",
        imageAlt: null,
        images: [],
        primaryLanguage: null,
        parents: [],
        children: [],
        childDubLanguages: [],
        variants: [selectedVariant],
        subtitles: [],
        studyQuestions: [],
        bibleCitations: [],
      },
    })

    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: "https://image.mux.com/mux-playback-id/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
        width: 1200,
        height: 630,
        alt: "Jesus",
      }),
    ])
  })

  it("keeps the editorial still when no selected Mux playback id exists", async () => {
    const { generateWatchVideoMetadata } = await import("./experience-metadata")
    const selectedVariant = {
      documentId: "dub-en",
      slug: null,
      published: true,
      hls: "https://cdn.example/jesus-en.m3u8",
      duration: null,
      language: {
        slug: "english",
        bcp47: "en",
        coreId: "529",
        name: "English",
        nativeName: "English",
      },
      downloads: [],
      muxVideo: null,
    }

    const metadata = generateWatchVideoMetadata("en", {
      routeSlug: "jesus",
      pathLocale: "english",
      selectedVariant,
      video: {
        documentId: "video-1",
        slug: "jesus",
        publishedAt: null,
        title: "Jesus",
        snippet: null,
        description: null,
        noIndex: false,
        label: "featureFilm",
        imageAlt: "Jesus teaching outside",
        images: [
          {
            documentId: "img-1",
            url: "https://bad.example/raw",
            thumbnail: "https://cdn.example/thumb.jpg",
            mobileCinematicHigh: "https://cdn.example/still-high.jpg",
            mobileCinematicLow: "https://cdn.example/still-low.jpg",
          },
        ],
        primaryLanguage: null,
        parents: [],
        children: [],
        childDubLanguages: [],
        variants: [selectedVariant],
        subtitles: [],
        studyQuestions: [],
        bibleCitations: [],
      },
    })

    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: "https://cdn.example/still-high.jpg",
        alt: "Jesus teaching outside",
      }),
    ])
  })
})
