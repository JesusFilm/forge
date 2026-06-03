import { normalizeVideo } from "../normalizeVideo"

function makeRawVideo(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "vid-1",
    slug: "the-crucifixion",
    label: "SEGMENT",
    images: [
      {
        documentId: "img-1",
        url: "https://img.example.com/poster.jpg",
        thumbnail: "https://img.example.com/thumb.jpg",
        mobileCinematicHigh: "https://img.example.com/cinematic.jpg",
        mobileCinematicLow: null,
      },
    ],
    primaryLanguage: { coreId: "529", bcp47: "en" },
    locales: [
      {
        documentId: "loc-1",
        languageSlug: "english",
        title: "The Crucifixion",
        description: "A depiction of the crucifixion.",
        snippet: "Short snippet",
        imageAlt: "Crucifixion scene",
      },
    ],
    parents: [
      {
        parent: {
          documentId: "parent-1",
          slug: "easter-story",
          label: "COLLECTION",
          locales: [
            {
              documentId: "ploc-1",
              languageSlug: "english",
              title: "The Easter Story",
            },
          ],
          images: [],
          children: [
            {
              child: {
                documentId: "vid-1",
                slug: "the-crucifixion",
                label: "SEGMENT",
                locales: [
                  {
                    documentId: "cloc-1",
                    languageSlug: "english",
                    title: "The Crucifixion",
                  },
                ],
                images: [
                  {
                    documentId: "cimg-1",
                    url: "https://img.example.com/crucifixion.jpg",
                    thumbnail: null,
                    mobileCinematicHigh: null,
                    mobileCinematicLow: null,
                  },
                ],
              },
            },
            {
              child: {
                documentId: "vid-2",
                slug: "the-resurrection",
                label: "SEGMENT",
                locales: [
                  {
                    documentId: "cloc-2",
                    languageSlug: "english",
                    title: "The Resurrection",
                  },
                ],
                images: [
                  {
                    documentId: "cimg-2",
                    url: "https://img.example.com/resurrection.jpg",
                    thumbnail: null,
                    mobileCinematicHigh: null,
                    mobileCinematicLow: null,
                  },
                ],
              },
            },
            {
              child: {
                documentId: "vid-3",
                slug: "the-ascension",
                label: "SEGMENT",
                locales: [
                  {
                    documentId: "cloc-3",
                    languageSlug: "english",
                    title: "The Ascension",
                  },
                ],
                images: [],
              },
            },
          ],
        },
      },
    ],
    variants: [
      {
        documentId: "dub-1",
        slug: "the-crucifixion-english",
        published: true,
        hls: "https://stream.mux.com/abc123.m3u8",
        duration: 725,
        language: {
          coreId: "529",
          bcp47: "en",
          slug: "english",
          name: { en: "English" },
        },
        downloads: [
          {
            documentId: "dl-1",
            quality: "720p",
            size: "52428800",
            url: "https://dl.example.com/720p.mp4",
          },
          {
            documentId: "dl-2",
            quality: "480p",
            size: "26214400",
            url: "https://dl.example.com/480p.mp4",
          },
        ],
        muxVideo: { playbackId: "abc123" },
        videoEdition: {
          subtitles: [
            {
              documentId: "sub-1",
              language: { slug: "english", name: "English", bcp47: "en" },
              vttSrc: "https://subs.example.com/en.vtt",
              primary: true,
              aiGenerated: false,
            },
            {
              documentId: "sub-2",
              language: {
                slug: "spanish",
                name: { en: "Spanish", es: "Español" },
                bcp47: "es",
              },
              vttSrc: "https://subs.example.com/es.vtt",
              primary: false,
              aiGenerated: true,
            },
          ],
        },
      },
      {
        documentId: "dub-2",
        slug: "the-crucifixion-spanish",
        published: true,
        hls: "https://stream.mux.com/def456.m3u8",
        duration: 730,
        language: {
          coreId: "21028",
          bcp47: "es",
          slug: "spanish",
          name: { en: "Spanish", es: "Español" },
        },
        downloads: [],
        muxVideo: { playbackId: "def456" },
        videoEdition: { subtitles: [] },
      },
      {
        documentId: "dub-3",
        slug: "unpublished-dub",
        published: false,
        hls: null,
        duration: null,
        language: null,
        downloads: [],
        muxVideo: null,
        videoEdition: null,
      },
    ],
    studyQuestions: [
      {
        documentId: "sq-2",
        languageSlug: "english",
        value: "Second question?",
        order: 2,
      },
      {
        documentId: "sq-1",
        languageSlug: "english",
        value: "First question?",
        order: 1,
      },
      { documentId: "sq-3", languageSlug: "english", value: "", order: 3 },
    ],
    bibleCitations: [
      {
        documentId: "bc-1",
        chapterStart: 19,
        chapterEnd: 19,
        verseStart: 30,
        verseEnd: 30,
        order: 1,
        osisId: "John.19.30",
        bibleBook: { documentId: "bb-1", name: { en: "John" } },
      },
    ],
    ...overrides,
  } as Parameters<typeof normalizeVideo>[0]
}

describe("normalizeVideo", () => {
  it("returns null for null input", () => {
    expect(normalizeVideo(null)).toBeNull()
    expect(normalizeVideo(undefined)).toBeNull()
  })

  it("produces a complete record from a fully populated response", () => {
    const result = normalizeVideo(makeRawVideo())!

    expect(result.documentId).toBe("vid-1")
    expect(result.slug).toBe("the-crucifixion")
    expect(result.label).toBe("SEGMENT")
    expect(result.title).toBe("The Crucifixion")
    expect(result.description).toBe("A depiction of the crucifixion.")
    expect(result.posterUrl).toBe("https://img.example.com/cinematic.jpg")
    expect(result.streamingUrl).toBe("https://stream.mux.com/abc123.m3u8")
    expect(result.muxPlaybackId).toBe("abc123")
    expect(result.duration).toBe(725)
    expect(result.primaryLanguageBcp47).toBe("en")
  })

  it("filters self-references from siblings", () => {
    const result = normalizeVideo(makeRawVideo())!

    expect(result.siblings).toHaveLength(2)
    expect(result.siblings.map((s) => s.slug)).toEqual([
      "the-resurrection",
      "the-ascension",
    ])
  })

  it("deduplicates siblings by documentId", () => {
    const raw = makeRawVideo()
    const parent = raw!.parents![0]!.parent!
    parent.children = [
      ...parent.children!,
      {
        child: {
          documentId: "vid-2",
          slug: "the-resurrection",
          label: "SEGMENT",
          locales: [
            {
              documentId: "cloc-2",
              languageSlug: "english",
              title: "The Resurrection",
            },
          ],
          images: [],
        },
      },
    ]

    const result = normalizeVideo(raw)!
    const resurrectionCount = result.siblings.filter(
      (s) => s.documentId === "vid-2",
    ).length
    expect(resurrectionCount).toBe(1)
  })

  it("returns empty siblings for orphan videos (no parents)", () => {
    const result = normalizeVideo(makeRawVideo({ parents: [] }))!
    expect(result.siblings).toEqual([])
  })

  it("filters unpublished variants", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.variants).toHaveLength(2)
    expect(result.variants.every((v) => v.published)).toBe(true)
  })

  it("preserves downloads with quality and URL", () => {
    const result = normalizeVideo(makeRawVideo())!
    const englishVariant = result.variants.find(
      (v) => v.languageSlug === "english",
    )!
    expect(englishVariant.downloads).toHaveLength(2)
    expect(englishVariant.downloads[0]).toEqual({
      documentId: "dl-1",
      quality: "720p",
      size: "52428800",
      url: "https://dl.example.com/720p.mp4",
    })
  })

  it("maps subtitles with language info", () => {
    const result = normalizeVideo(makeRawVideo())!
    const englishVariant = result.variants.find(
      (v) => v.languageSlug === "english",
    )!
    expect(englishVariant.subtitles).toHaveLength(2)
    expect(englishVariant.subtitles[0].languageBcp47).toBe("en")
    expect(englishVariant.subtitles[0].primary).toBe(true)
    expect(englishVariant.subtitles[1].aiGenerated).toBe(true)
  })

  it("sorts study questions by order and filters empty", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.studyQuestions).toHaveLength(2)
    expect(result.studyQuestions[0].value).toBe("First question?")
    expect(result.studyQuestions[1].value).toBe("Second question?")
  })

  it("chooses broad locale rows deterministically when multiple variants share BCP-47", () => {
    const result = normalizeVideo(
      makeRawVideo({
        locales: [
          {
            documentId: "loc-z",
            languageSlug: "russian-z",
            title: "Russian Z",
            description: "Russian Z description",
            snippet: "Russian Z snippet",
          },
          {
            documentId: "loc-legacy",
            languageSlug: null,
            title: "Legacy Russian",
            description: "Legacy Russian description",
            snippet: "Legacy Russian snippet",
          },
          {
            documentId: "loc-a",
            languageSlug: "russian-a",
            title: "Russian A",
            description: "Russian A description",
            snippet: "Russian A snippet",
          },
        ],
        studyQuestions: [
          {
            documentId: "sq-z",
            languageSlug: "russian-z",
            value: "Z question?",
            order: 1,
          },
          {
            documentId: "sq-legacy",
            languageSlug: null,
            value: "Legacy question?",
            order: 1,
          },
          {
            documentId: "sq-a",
            languageSlug: "russian-a",
            value: "A question?",
            order: 1,
          },
        ],
      }),
    )!

    expect(result.title).toBe("Russian A")
    expect(result.studyQuestions.map((question) => question.value)).toEqual([
      "A question?",
      "Z question?",
      "Legacy question?",
    ])
  })

  it("normalizes bible citations with book name from locale map", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.bibleCitations).toHaveLength(1)
    expect(result.bibleCitations[0].bookName).toBe("John")
    expect(result.bibleCitations[0].osisId).toBe("John.19.30")
    expect(result.bibleCitations[0].chapterStart).toBe(19)
    expect(result.bibleCitations[0].verseStart).toBe(30)
  })

  it("handles missing fields gracefully", () => {
    const result = normalizeVideo(
      makeRawVideo({
        locales: [],
        images: [],
        variants: [],
        studyQuestions: null,
        bibleCitations: null,
        parents: null,
        primaryLanguage: null,
      }),
    )!

    expect(result.title).toBeNull()
    expect(result.description).toBeNull()
    expect(result.posterUrl).toBeNull()
    expect(result.streamingUrl).toBeNull()
    expect(result.muxPlaybackId).toBeNull()
    expect(result.primaryLanguageBcp47).toBeNull()
    expect(result.siblings).toEqual([])
    expect(result.variants).toEqual([])
    expect(result.studyQuestions).toEqual([])
    expect(result.bibleCitations).toEqual([])
  })

  it("uses first parent's children for siblings with multiple parents", () => {
    const raw = makeRawVideo({
      parents: [
        {
          parent: {
            documentId: "parent-1",
            slug: "easter-story",
            label: "COLLECTION",
            locales: [],
            images: [],
            children: [
              {
                child: {
                  documentId: "vid-2",
                  slug: "from-first-parent",
                  label: "SEGMENT",
                  locales: [
                    {
                      documentId: "l1",
                      languageSlug: "english",
                      title: "From First Parent",
                    },
                  ],
                  images: [],
                },
              },
            ],
          },
        },
        {
          parent: {
            documentId: "parent-2",
            slug: "other-collection",
            label: "COLLECTION",
            locales: [],
            images: [],
            children: [
              {
                child: {
                  documentId: "vid-99",
                  slug: "from-second-parent",
                  label: "SEGMENT",
                  locales: [
                    {
                      documentId: "l2",
                      languageSlug: "english",
                      title: "From Second Parent",
                    },
                  ],
                  images: [],
                },
              },
            ],
          },
        },
      ],
    })
    const result = normalizeVideo(raw)!
    expect(result.siblings).toHaveLength(1)
    expect(result.siblings[0].slug).toBe("from-first-parent")
  })
})

describe("normalizeVideo — partial data (returnPartialData)", () => {
  const partial = (o: Record<string, unknown>) =>
    o as unknown as Parameters<typeof normalizeVideo>[0]

  it("returns null for null / undefined input", () => {
    expect(normalizeVideo(null)).toBeNull()
    expect(normalizeVideo(undefined)).toBeNull()
  })

  it("returns null when the partial object has no documentId (no identity yet)", () => {
    expect(normalizeVideo(partial({ slug: "lonely" }))).toBeNull()
    expect(normalizeVideo(makeRawVideo({ documentId: "" }) as never)).toBeNull()
  })

  it("produces a valid record with empty arrays when relations are absent", () => {
    const result = normalizeVideo(
      partial({ documentId: "vid-9", slug: "lonely", label: "SEGMENT" }),
    )!
    expect(result).not.toBeNull()
    expect(result.documentId).toBe("vid-9")
    expect(result.slug).toBe("lonely")
    expect(result.variants).toEqual([])
    expect(result.siblings).toEqual([])
    expect(result.studyQuestions).toEqual([])
    expect(result.bibleCitations).toEqual([])
    expect(result.streamingUrl).toBeNull()
    expect(result.posterUrl).toBeNull()
    expect(result.title).toBeNull()
  })
})
