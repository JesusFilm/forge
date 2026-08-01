import { afterEach, describe, expect, it, vi } from "vitest"
import type { WatchVideoRecord } from "./content"

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

  it("uses the approved localized JESUS overrides verbatim on language-less pages", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "video-template",
        template: {
          documentId: "exp-template-jesus",
          slug: "single-video",
        },
        routeVideo: {
          documentId: "video-jesus",
          slug: "jesus",
          title: "JESUS",
          snippet: "The story of Jesus.",
          description: "Visible description",
          searchTitle:
            "  Watch JESUS — Full Movie Free Online | Jesus Film Project  ",
          searchDescription:
            "  Watch the JESUS film free online. Follow his life, teachings, miracles, death, and resurrection through the Gospel of Luke in more than 2,000 languages.  ",
          socialImage: {
            url: "https://media.example/jesus-social.jpg",
            width: null,
            height: null,
          },
          noIndex: false,
          imageUrl: "https://cdn.example/jesus.jpg",
          imageAlt: "JESUS film still",
          streamingUrl: "https://cdn.example/jesus.m3u8",
          relatedItems: [],
        },
      },
      error: null,
    })

    const { getWatchPageMetadata } = await import("./experience-metadata")
    const metadata = await getWatchPageMetadata("en", { slug: "jesus" })
    const approvedTitle =
      "Watch JESUS — Full Movie Free Online | Jesus Film Project"
    const approvedDescription =
      "Watch the JESUS film free online. Follow his life, teachings, miracles, death, and resurrection through the Gospel of Luke in more than 2,000 languages."

    expect(metadata.title).toBe(approvedTitle)
    expect(metadata.description).toBe(approvedDescription)
    expect(metadata.openGraph).toMatchObject({
      title: approvedTitle,
      description: approvedDescription,
      siteName: "Jesus Film Project",
      locale: "en_US",
      images: [
        {
          url: "https://media.example/jesus-social.jpg",
          width: 1400,
          height: 933,
          alt: "JESUS film still",
        },
      ],
    })
    expect(metadata.twitter).toMatchObject({
      title: approvedTitle,
      description: approvedDescription,
      images: [
        {
          url: "https://media.example/jesus-social.jpg",
          alt: "JESUS film still",
        },
      ],
    })
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/jesus.html",
    )
    expect(metadata.robots).toEqual({ index: true, follow: true })
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
        localePublishedAt: null,
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
      url: "https://www.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html",
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
        "https://www.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html",
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
        localePublishedAt: null,
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
      "https://www.jesusfilm.org/watch/jesus-is-brought-to-pilate.html"
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
        localePublishedAt: null,
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
        localePublishedAt: null,
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

describe("buildWatchVideoMetadataModel", () => {
  const selectedVariant = {
    documentId: "dub-en",
    slug: null,
    published: true,
    hls: "https://cdn.example/life-en.m3u8",
    duration: 120,
    language: {
      slug: "english",
      bcp47: "en",
      coreId: "529",
      name: "English",
      nativeName: "English",
    },
    downloads: [],
    muxVideo: { playbackId: "mux-life" },
  }

  const video: WatchVideoRecord = {
    documentId: "video-1",
    slug: "life-of-jesus",
    publishedAt: "2026-06-01T12:00:00.000Z",
    localePublishedAt: null,
    title: null,
    snippet: "A feature film about Jesus.",
    description: "Watch the life of Jesus.",
    noIndex: false,
    label: "featureFilm",
    imageAlt: "Jesus speaks to a crowd",
    images: [],
    primaryLanguage: null,
    parents: [],
    children: [],
    childDubLanguages: [],
    variants: [selectedVariant],
    subtitles: [],
    studyQuestions: [],
    bibleCitations: [],
  }

  it("uses a trimmed resolved video title for structured data", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")

    const model = buildWatchVideoMetadataModel({
      routeSlug: "life-of-jesus",
      pathLocale: "english",
      selectedVariant,
      video: { ...video, title: "  Life of Jesus  " },
    })

    expect(model.structuredDataTitle).toBe("Life of Jesus")
  })

  it("isolates approved search and social overrides from VideoObject fields", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")
    const { watchVideoStructuredDataJson } =
      await import("./watch-structured-data")

    const model = buildWatchVideoMetadataModel({
      routeSlug: "jesus",
      pathLocale: "english",
      selectedVariant,
      video: {
        ...video,
        slug: "jesus",
        title: "JESUS",
        description: "Visible JESUS description",
        searchTitle:
          "  Watch JESUS — Full Movie Free Online | Jesus Film Project  ",
        searchDescription:
          "  Watch the JESUS film free online. Follow his life, teachings, miracles, death, and resurrection through the Gospel of Luke in more than 2,000 languages.  ",
        socialImage: {
          url: "https://media.example/jesus-social.jpg",
          width: 1200,
          height: 630,
        },
      },
    })

    expect(model.title).toBe(
      "Watch JESUS — Full Movie Free Online | Jesus Film Project",
    )
    expect(model.description).toBe(
      "Watch the JESUS film free online. Follow his life, teachings, miracles, death, and resurrection through the Gospel of Luke in more than 2,000 languages.",
    )
    expect(model.image).toMatchObject({
      url: "https://media.example/jesus-social.jpg",
      width: 1200,
      height: 630,
    })
    expect(model.videoTitle).toBe("JESUS")
    expect(model.structuredDataTitle).toBe("JESUS")
    expect(model.structuredDataDescription).toBe("Visible JESUS description")
    expect(model.structuredDataThumbnailUrl).toBe(
      "https://image.mux.com/mux-life/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
    )
    const structuredData = JSON.parse(
      watchVideoStructuredDataJson(model) as string,
    ) as Record<string, unknown>
    expect(structuredData.name).toBe("JESUS")
    expect(structuredData.description).toBe("Visible JESUS description")
    expect(structuredData.thumbnailUrl).toEqual([
      "https://image.mux.com/mux-life/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop",
    ])
  })

  it("falls back field-by-field for blank localized overrides", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")

    const model = buildWatchVideoMetadataModel({
      routeSlug: "jesus",
      pathLocale: "spanish-castilian",
      selectedVariant,
      video: {
        ...video,
        title: "Jesús",
        description: "Descripción localizada",
        searchTitle: "   ",
        searchDescription: "\n\t",
      },
    })

    expect(model.title).toBe("Jesús | Jesus Film Project")
    expect(model.description).toBe("Descripción localizada")
  })

  it("aligns English, international, and collision-owned canonical identities", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")
    const build = (routeSlug: string, pathLocale: string) =>
      buildWatchVideoMetadataModel({
        routeSlug,
        pathLocale,
        selectedVariant,
        video: { ...video, slug: routeSlug },
      }).canonicalUrl

    expect(build("life-of-jesus", "english")).toBe(
      "https://www.jesusfilm.org/watch/life-of-jesus.html",
    )
    expect(build("life-of-jesus", "romanian")).toBe(
      "https://www.jesusfilm.org/watch/life-of-jesus.html/romanian.html",
    )
    expect(build("russian", "english")).toBe(
      "https://www.jesusfilm.org/watch/russian.html/english.html",
    )
  })

  it("uses a title-based structured-data description fallback without changing page metadata", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")

    const model = buildWatchVideoMetadataModel({
      routeSlug: "life-of-jesus",
      pathLocale: "english",
      selectedVariant,
      video: {
        ...video,
        title: "Life of Jesus",
        description: null,
        snippet: null,
      },
    })

    expect(model.description).toBe("")
    expect(model.structuredDataDescription).toBe(
      "Watch Life of Jesus from Jesus Film Project.",
    )
  })

  it("uses localized publish date as the structured-data upload date fallback", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")

    const model = buildWatchVideoMetadataModel({
      routeSlug: "life-of-jesus",
      pathLocale: "english",
      selectedVariant,
      video: {
        ...video,
        publishedAt: null,
        localePublishedAt: "2026-06-02T12:00:00.000Z",
      },
    })

    expect(model.uploadDate).toBe("2026-06-02T12:00:00.000Z")
  })

  it("prefers valid video publish date over localized publish date", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")

    const model = buildWatchVideoMetadataModel({
      routeSlug: "life-of-jesus",
      pathLocale: "english",
      selectedVariant,
      video: {
        ...video,
        publishedAt: "2026-06-01T12:00:00.000Z",
        localePublishedAt: "2026-06-02T12:00:00.000Z",
      },
    })

    expect(model.uploadDate).toBe("2026-06-01T12:00:00.000Z")
  })

  it("uses localized publish date when the video publish date is invalid", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")

    const model = buildWatchVideoMetadataModel({
      routeSlug: "life-of-jesus",
      pathLocale: "english",
      selectedVariant,
      video: {
        ...video,
        publishedAt: "not a date",
        localePublishedAt: "2026-06-02T12:00:00.000Z",
      },
    })

    expect(model.uploadDate).toBe("2026-06-02T12:00:00.000Z")
  })

  it("does not use the slug fallback as a structured-data title", async () => {
    const { buildWatchVideoMetadataModel } =
      await import("./experience-metadata")

    const model = buildWatchVideoMetadataModel({
      routeSlug: "life-of-jesus",
      pathLocale: "english",
      selectedVariant,
      video,
    })

    expect(model.structuredDataTitle).toBeNull()
    expect(model.structuredDataDescription).toBe("Watch the life of Jesus.")
    expect(model.videoTitle).toBe("life-of-jesus")
    expect(model.title).toBe("life-of-jesus | Jesus Film Project")
  })
})
